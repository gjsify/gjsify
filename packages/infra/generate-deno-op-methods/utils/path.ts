export const getOpTsFilePath = (path: string, methodName: string) => {
  const filename = path.split("/").pop()!;
  const parentDir = path.replace(filename, "");
  const dir = parentDir + +filename.replace(/\.rs$/, "_gjsify");
  return dir + "/" + methodName + ".ts";
};
