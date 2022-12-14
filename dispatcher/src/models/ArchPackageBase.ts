import { spawnSync, spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import { Arch } from "../types/enums";
import config from "./config";
import fs from "fs";
import log4js from "log4js";
import date from "date-format";
import docker from "../utils/docker";
import { DockerRunConfig, SshConfig } from "../types/ConfigTypes";
import wrapChildProcess from "../utils/wrapChildProcess";

export default class ArchPackageBase {
  protected readonly log: log4js.Logger;
  public constructor(public readonly pkgbase: string, public readonly arch: Arch) {
    this.log = log4js.getLogger(`Package.${pkgbase}-${arch}`);
  }

  public extraDeps = "";
  public ignorePkgs = "";

  get path() {
    return path.join(config.paths.sources[this.arch], this.pkgbase);
  }

  get archesSupported(): "any" | Arch[] {
    const bash = spawnSync("bash", ["-c", "source PKGBUILD; echo ${arch[@]}"], {
      cwd: this.path,
      encoding: "utf-8",
    });
    if (bash.status !== 0) {
      this.log.fatal("bash -c 'source PKGBUILD; echo ${arch[@]}' Exit code:", bash.status);
      this.log.fatal(bash.stderr);
      throw new Error(bash.stderr);
    }

    const arches = bash.stdout
      .trim()
      .split(" ")
      .filter((it) => it);

    if (arches[0] === "any") {
      return "any";
    }
    return arches as Arch[];
  }

  /**
   * 当前目录被 build 之后能得到的包文件
   */
  private get filesToGet() {
    const pkgbuild = fs.readFileSync(path.join(this.path, "PKGBUILD"), "utf-8");
    if (pkgbuild.includes("pkgver()")) {
      this.log.trace("-git");
      // 应该是个 -git 包
      // makepkg -sfAod，有权限问题
      const res = spawnSync("bash", ["-c", "makepkg -sfAod --skipinteg"], {
        cwd: this.path,
        encoding: "utf-8",
        env: {
          CARCH: this.arch,
        },
      });
      const level = res.status ? "error" : "trace";
      this.log[level]("Update pkgver:", res.status);
      this.log.debug(res.stdout, res.stderr);
    }
    const pkglist = spawnSync("bash", ["-c", "makepkg --packagelist --skipinteg"], {
      cwd: this.path,
      encoding: "utf-8",
      env: {
        CARCH: this.arch,
      },
    });
    if (pkglist.status !== 0) {
      this.log.fatal("makepkg --packagelist Exit code:", pkglist.status);
      this.log.fatal(pkglist.stderr);
      throw new Error(pkglist.stderr);
    }

    return pkglist.stdout
      .split("\n")
      .filter((it) => it)
      .map((line) => path.basename(line))
      .map((line) => line.substring(0, line.indexOf(".pkg.tar")));
  }

  /**
   * pkgfiles 中包含的上次 build 结果
   */
  private get filesWeHaveBasenames() {
    try {
      const pkgfiles = fs.readFileSync(path.join(this.path, "pkgfiles"), "utf-8");
      return pkgfiles
        .split("\n")
        .filter((it) => it)
        .map((line) => path.basename(line));
    } catch {
      return [];
    }
  }

  private get filesWeHaveBasenamesWithoutExts() {
    return this.filesWeHaveBasenames.map((line) => line.substring(0, line.indexOf(".pkg.tar")));
  }

  // 包含完整路径
  public get filesWeHave() {
    return this.filesWeHaveBasenames.map((file) => path.join(this.path, file));
  }

  /**
   * 根据数据库对比是否需要重新构建
   */
  get rebuildNeeded() {
    this.log.trace("this.filesWeHaveBasenamesWithoutExts", this.filesWeHaveBasenamesWithoutExts);
    const filesToGet = this.filesToGet;
    this.log.trace("this.filesToGet", filesToGet);
    return filesToGet.some((file) => !this.filesWeHaveBasenamesWithoutExts.includes(file));
  }

  public build(log = log4js.getLogger(`Build.${this.pkgbase}-${this.arch}.${date("yyyy-MM-dd.hhmmss")}`)) {
    // 这里面应该都是 ssh 执行的命令
    log.mark("Start building");
    let builder: ChildProcessWithoutNullStreams;
    const builderConfig = config.builders[this.arch];
    const dockerConfig = {
      ...builderConfig,
      ...config.arches[this.arch],
      volumes: {
        "/work": this.path,
        "/scripts": `${config.paths.program}/builder/scripts`,
        "/mirrors": `${config.paths.localMirrors}`,
      },
      rm: true,
      command: [
        "sudo",
        "-Hu",
        "builder",
        `EXTRA_DEPENDS=${this.extraDeps}`,
        `IGNORE_PACKAGES=${this.ignorePkgs}`,
        "/scripts/build.sh",
      ],
    };

    switch (builderConfig.type) {
      case "local": {
        builder = docker.run(dockerConfig as DockerRunConfig);
        break;
      }
      case "ssh-docker": {
        builder = docker.runOverSsh(dockerConfig as DockerRunConfig & SshConfig);
        break;
      }
      case "ssh-command":
        // TODO
        throw new Error("Not implemented");
    }
    return wrapChildProcess(builder, log);
  }
}
