import YAML from "yaml";
import fs from "fs";
import { Arch } from "../types/enums";
import { ArchConfig, Builder, PackageInit } from "../types/ConfigTypes";

const CONFIG_PATH = process.env.CONFIG;

const config = YAML.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
  builders: { [key in Arch]: Builder };
  paths: {
    sources: { [key in Arch]: string };
    logs: string;
    program: string;
    repo: string;
    localMirrors: string;
  };
  pacman: Array<PackageInit>;
  arches: { [key in Arch]: ArchConfig };
  repoName: string;
};

export const reloadConfig = () => {
  Object.assign(config, YAML.parse(fs.readFileSync(CONFIG_PATH, "utf-8")));
};

export default config;
