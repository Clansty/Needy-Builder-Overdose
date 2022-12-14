import { ChildProcessWithoutNullStreams } from "child_process";
import { Logger } from "log4js";

/**
 * 将一个 spawn 出来的 child process 转换成一个 Promise，
 * 并将输出定向到 Logger，并在返回 0 时 resolve，返回非 0 时 reject
 */
export default (command: ChildProcessWithoutNullStreams, log: Logger) =>
  new Promise<void>((resolve, reject) => {
    command.stdout.on("data", (data) => {
      log.info(data.toString("utf8").trim());
    });
    command.stderr.on("data", (data) => {
      log.warn(data.toString("utf8").trim());
    });
    command.on("close", (code) => {
      const level = code ? "error" : "trace";
      log[level]("Child process exited:", code);
      if (code === 0) {
        resolve();
      } else {
        reject(`Child process returned ${code}`);
      }
    });
  });
