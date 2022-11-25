import '@gjsify/node-globals';
import { serialize, deserialize } from '@deepkit/type';

const log = globalThis.print || console.log;

class MyModel {
    id: number = 0;
    created: Date = new Date;

    constructor(public name: string) {
    }
}

const myModel = new MyModel('Peter');
const jsonObject = serialize<MyModel>(myModel);
const json = JSON.stringify(jsonObject);

log("json", json);
log("jsonObject", jsonObject, typeof jsonObject.created, jsonObject.created instanceof Date );
log("myModel", myModel, typeof myModel.created, myModel.created instanceof Date );


const myModelBack = deserialize<MyModel>(myModel);
log("myModelBack", myModelBack, typeof myModelBack.created, myModelBack.created instanceof Date );

log(deserialize<boolean>('false')); //false
log(deserialize<boolean>('0')); //false
log(deserialize<boolean>('1')); //true

log(deserialize<number>('1')); //1

log(deserialize<string>(1)); //'1'