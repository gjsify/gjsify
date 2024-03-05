/**
 * Get the typescript filename for a given rust source file path and method name.
 * E.g. "runtime/ops/fs_events.rs", "op_fs_events_poll" -> "runtime/ops/fs_events/op_fs_events_poll.ts"
 * @param path
 * @param methodName
 * @returns
 */
export const getOpTsFilePath = (path: string, methodName: string) => {
  const filename = path.split("/").pop()!;
  const parentDir = path.replace(filename, "");
  const dir = parentDir + filename.replace(/\.rs$/, "");
  const res = dir + "/" + methodName + ".ts";
  return res;
};
