export const getGjsVersion = () => {
    const v = imports.system.version.toString();
    return `${v[0]}.${+(v[1] + v[2])}.${+(v[3] + v[4])}`;
}