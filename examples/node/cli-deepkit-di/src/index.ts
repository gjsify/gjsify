
import { InjectorContext } from '@deepkit/injector';

const printGjs = (globalThis as unknown as { print?: (msg: string) => void }).print;
const log: (...args: unknown[]) => void = printGjs
    ? (...args) => printGjs(args.map((a) => String(a)).join(' '))
    : console.log.bind(console);

// Dependency Inversion

interface HttpClientInterface {
    get(path: string): Promise<any>;
}
 
class UserRepository {
    constructor(
        private http: HttpClientInterface
    ) {}

    async getUsers(): Promise<any> {
        return await this.http.get('/users');
    }
}

class HttpClient implements HttpClientInterface {
    async get(path: string) {
        return ["Pascal"]
    }
}

const injector = InjectorContext.forProviders([
    UserRepository,
    HttpClient,
]);

// Dependency Inversion

const run = async () => {
    const userRepo = injector.get(UserRepository);

    const users = await userRepo.getUsers();
    
    log('users', users);
}

run().catch(console.error);