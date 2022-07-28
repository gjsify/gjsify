import { serialize, deserialize } from '@deepkit/type';

class MyModel {
    id: number = 0;
    created: Date = new Date;

    constructor(public name: string) {
    }
}

const myModel = new MyModel('Peter');
const jsonObject = serialize<MyModel>(myModel);
const json = JSON.stringify(jsonObject);

console.log("json", json);
console.log("jsonObject", jsonObject, typeof jsonObject.created);
console.log("myModel", myModel, typeof myModel.created );


const myModelBack = deserialize<MyModel>(myModel);
console.log("myModelBack", myModelBack, typeof myModelBack.created );

console.log(deserialize<boolean>('false')); //false
console.log(deserialize<boolean>('0')); //false
console.log(deserialize<boolean>('1')); //true

console.log(deserialize<number>('1')); //1

console.log(deserialize<string>(1)); //'1'