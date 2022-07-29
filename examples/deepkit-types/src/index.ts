import '@gjsify/types/index';
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

print("json", json);
print("jsonObject", jsonObject, typeof jsonObject.created);
print("myModel", myModel, typeof myModel.created );


const myModelBack = deserialize<MyModel>(myModel);
print("myModelBack", myModelBack, typeof myModelBack.created );

print(deserialize<boolean>('false')); //false
print(deserialize<boolean>('0')); //false
print(deserialize<boolean>('1')); //true

print(deserialize<number>('1')); //1

print(deserialize<string>(1)); //'1'