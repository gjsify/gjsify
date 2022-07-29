import '@gjsify/types/index';
import { InjectorContext } from '@deepkit/injector';

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

const userRepo = injector.get(UserRepository);

const users = await userRepo.getUsers();

print("users", users);
