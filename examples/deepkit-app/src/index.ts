import '@gjsify/types/index';
import { App } from '@deepkit/app';

class Config {
    debug: boolean = false;
    domain: string = 'localhost';
}

class MyService {
    constructor(private domain: Config['domain']) {}

    doIt() {
        this.domain; //localhost
    }
}

new App({
    config: Config,
    providers: [MyService]
}).run();
