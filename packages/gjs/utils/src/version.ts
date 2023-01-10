import { System } from '@gjsify/types/Gjs';

export const getGjsVersion = () => {
    const v = System.version.toString();
    return `${v[0]}.${+(v[1] + v[2])}.${+(v[3] + v[4])}`;
}