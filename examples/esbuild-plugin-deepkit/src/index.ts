import { deserialize } from '@deepkit/type';

interface Config {
    color: string;
}

interface User {
    id: number;
    createdAt: Date;
    firstName?: string;
    lastName?: string;
    config: Config;
    username: string;
}

//deserialize JSON object to real instances
const user = deserialize<User>({
    id: 0,
    username: 'peter',
    createdAt: '2021-06-26T12:34:41.061Z',
    config: {color: '#221122'},
});


console.log(user.createdAt instanceof Date); // true
