import log4js, { getLogger } from "log4js";
import config from "../models/config";
import { ChildProcessWithoutNullStreams } from "child_process";
import docker from "../utils/docker";
import { ArchConfig } from "../types/ConfigTypes";
import wrapChildProcess from "../utils/wrapChildProcess";
import AurPackageBase from "../models/AurPackageBase";
import { Arch } from "../types/enums";
import BuildStatus from "../models/BuildStatus";
import UpdatedPackage from "../models/UpdatedPackage";
import date from "date-format";

export default class MainRunController {
  private log = log4js.getLogger("Dispatcher");

  private isRunning = false;
  private status: BuildStatus;

  private async updateDockerImages() {
    for (const [arch, builder] of Object.entries(config.builders)) {
      this.log.info("Update docker image for", arch, "builder...");
      try {
        const archCfg: ArchConfig = config.arches[arch];
        let command: ChildProcessWithoutNullStreams;
        switch (builder.type) {
          case "local":
            command = docker.pull({ ...archCfg, ...builder });
            break;
          case "ssh-docker":
            command = docker.pullOverSsh({ ...archCfg, ...builder });
            break;
          default:
            this.log.info("No need for type", builder.type);
            break;
        }
        await wrapChildProcess(command, log4js.getLogger(`UpdateDocker.${arch}`));
        this.log.info("Update docker image for", arch, "builder done");
      } catch (error) {
        this.log.error("Unable to update docker image for", arch, "builder");
      }
    }
  }

  private async updateSources() {
    this.log.info("Fetch sources...");

    for (const pkgInit of config.pacman) {
      const pkg = new AurPackageBase(pkgInit, "x86_64");
      this.log.info("Fetching:", pkg.pkgbase, pkg.arch);
      try {
        // await pkg.updateSource();
        this.status.allPackages.x86_64.push(pkg);
      } catch (error) {
        this.log.error(pkg.pkgbase, error);
        continue;
      }
      let arches = pkg.archesSupported;
      if (arches === "any") {
        arches = Object.keys(config.arches) as Arch[];
      }
      if (typeof pkgInit === "object") {
        for (const archSupported of Object.keys(config.arches) as Arch[]) {
          if (pkgInit[archSupported] && !arches.includes(archSupported)) {
            arches.push(archSupported);
          }
        }
      }
      for (const arch of arches.filter((it) => it !== "x86_64" && config.arches[it])) {
        const pkg = new AurPackageBase(pkgInit, arch);
        this.log.info("Fetching:", pkg.pkgbase, pkg.arch);
        try {
          // await pkg.updateSource();
          this.status.allPackages[arch].push(pkg);
        } catch (error) {
          this.log.error(pkg.pkgbase, error);
          continue;
        }
      }
    }
  }

  private calculateUpdatedPackages() {
    this.log.info("Calculating updated packages...");
    for (const arch of Object.keys(config.arches)) {
      const archPakcages = this.status.allPackages[arch] as AurPackageBase[];
      this.status.updatedPackages[arch].push(
        ...archPakcages.filter((pkg) => pkg.rebuildNeeded).map((pkg) => new UpdatedPackage(pkg))
      );
    }
  }

  private buildPackages() {
    // 并行构建每个架构的包，因为它们不在同一个机器上
    const promises = Object.keys(config.arches).map(
      (arch) =>
        new Promise<void>(async (resolve) => {
          const packages = this.status.updatedPackages[arch] as UpdatedPackage[];
          for (const pkg of packages) {
            this.log.info(arch, "builder start building", pkg.pkg.pkgbase);
            pkg.buildDate = new Date();
            try {
              await pkg.pkg.build(
                getLogger(`Build.${pkg.pkg.pkgbase}-${arch}.${date("yyyy-MM-dd.hhmmss", pkg.buildDate)}`)
              );
              // TODO: add to repo
              pkg.success = true;
            } catch (error) {
              this.status.errors.push(`${pkg.pkg.pkgbase}-${arch}: Build failed`);
            }
            await this.status.saveStatus();
          }
          resolve();
        })
    );
    return Promise.all(promises);
  }

  public async run() {
    if (this.isRunning) {
      throw new Error("Running");
    }
    this.isRunning = true;
    this.status = new BuildStatus();
    // await this.updateDockerImages();
    await this.updateSources();
    this.calculateUpdatedPackages();
    await this.status.saveStatus();
    await this.buildPackages();
    this.isRunning = false;
  }
}
