import '@gjsify/node-globals/register';
import {
    validate,
    is,
    assert,
    serialize,
    deserialize,
    MinLength,
    MaxLength,
    Positive,
    Maximum,
    Minimum,
    Pattern,
    Email,
    Validate,
    ValidatorError,
} from '@deepkit/type';
import type { Type } from '@deepkit/type';

const printGjs = (globalThis as unknown as { print?: (msg: string) => void }).print;
const log: (...args: unknown[]) => void = printGjs
    ? (...args) => printGjs(args.map((a) => String(a)).join(' '))
    : console.log.bind(console);

// ---------------------------------------------------------------------------
// 1. Basic type validation — TypeScript types become runtime validators
// ---------------------------------------------------------------------------

log('=== 1. Basic Type Validation ===');

log('is<string>("hello"):', is<string>('hello'));   // true
log('is<string>(42):     ', is<string>(42));        // false
log('is<number>(42):     ', is<number>(42));        // true
log('is<boolean>(true):  ', is<boolean>(true));     // true
log('is<boolean>("yes"): ', is<boolean>('yes'));     // false

// ---------------------------------------------------------------------------
// 2. Interface validation — complex objects validated at runtime
// ---------------------------------------------------------------------------

log('\n=== 2. Interface Validation ===');

interface Product {
    id: number;
    name: string;
    price: number;
    inStock: boolean;
}

const validProduct = { id: 1, name: 'Widget', price: 9.99, inStock: true };
const invalidProduct = { id: 'abc', name: 42, price: -5 };

log('valid product:  ', is<Product>(validProduct));    // true
log('invalid product:', is<Product>(invalidProduct));  // false

const errors = validate<Product>(invalidProduct);
for (const error of errors) {
    log(`  -> ${error.path}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 3. Type constraints — built-in validators via type intersections
// ---------------------------------------------------------------------------

log('\n=== 3. Type Constraints ===');

type Username = string & MinLength<3> & MaxLength<20>;
type Age = number & Positive & Maximum<150>;
type Price = number & Minimum<0> & Maximum<99999>;
type EmailAddress = string & Email;

log('Username "Jo":       ', is<Username>('Jo'));           // false (too short)
log('Username "John":     ', is<Username>('John'));         // true
log('Username (21 chars): ', is<Username>('a'.repeat(21))); // false (too long)

log('Age -5:   ', is<Age>(-5));     // false
log('Age 25:   ', is<Age>(25));     // true
log('Age 200:  ', is<Age>(200));    // false

log('Price 9.99:', is<Price>(9.99)); // true
log('Price -1:  ', is<Price>(-1));   // false

log('Email "test@example.com":', is<EmailAddress>('test@example.com')); // true
log('Email "not-an-email":    ', is<EmailAddress>('not-an-email'));      // false

// ---------------------------------------------------------------------------
// 4. Complex model validation — combining constraints in interfaces
// ---------------------------------------------------------------------------

log('\n=== 4. Complex Model Validation ===');

interface UserProfile {
    username: string & MinLength<3> & MaxLength<20>;
    email: string & Email;
    age: number & Positive & Maximum<150>;
    bio?: string & MaxLength<500>;
}

const validUser: unknown = {
    username: 'alice',
    email: 'alice@example.com',
    age: 28,
    bio: 'Hello, I like GNOME!',
};

const invalidUser: unknown = {
    username: 'ab',              // too short
    email: 'not-valid',          // no email
    age: -3,                     // not positive
    bio: 'x'.repeat(501),       // too long
};

log('Valid user:', is<UserProfile>(validUser));     // true
log('Invalid user:', is<UserProfile>(invalidUser)); // false

const userErrors = validate<UserProfile>(invalidUser);
log(`Found ${userErrors.length} validation errors:`);
for (const err of userErrors) {
    log(`  -> ${err.path}: [${err.code}] ${err.message}`);
}

// ---------------------------------------------------------------------------
// 5. Custom validators — build your own validation logic
// ---------------------------------------------------------------------------

log('\n=== 5. Custom Validators ===');

function isEven(value: number, type: Type) {
    if (value % 2 !== 0) {
        return new ValidatorError('isEven', 'Value must be an even number');
    }
}

function startsWith(value: string, type: Type, prefix: string) {
    if (!value.startsWith(prefix)) {
        return new ValidatorError('startsWith', `Value must start with "${prefix}"`);
    }
}

type EvenNumber = number & Validate<typeof isEven>;
type ProjectCode = string & Validate<typeof startsWith, 'PRJ-'> & MinLength<5>;

log('EvenNumber 4: ', is<EvenNumber>(4));   // true
log('EvenNumber 7: ', is<EvenNumber>(7));   // false

log('ProjectCode "PRJ-001":', is<ProjectCode>('PRJ-001')); // true
log('ProjectCode "ABC-001":', is<ProjectCode>('ABC-001')); // false
log('ProjectCode "PRJ-":   ', is<ProjectCode>('PRJ-'));     // false (too short? depends on minlength)

const codeErrors = validate<ProjectCode>('ABC');
for (const err of codeErrors) {
    log(`  -> [${err.code}] ${err.message}`);
}

// ---------------------------------------------------------------------------
// 6. assert() — throws on invalid data (great for input validation)
// ---------------------------------------------------------------------------

log('\n=== 6. Assert (throws on invalid) ===');

try {
    assert<UserProfile>({
        username: 'x',
        email: 'bad',
        age: -1,
    });
    log('This should not be reached');
} catch (error) {
    log('assert() threw:', (error as Error).message);
}

try {
    assert<UserProfile>(validUser);
    log('Valid user passed assert() successfully');
} catch {
    log('This should not be reached');
}

// ---------------------------------------------------------------------------
// 7. Nested object validation
// ---------------------------------------------------------------------------

log('\n=== 7. Nested Object Validation ===');

const ZIP_REGEX = /^\d{5}$/;

interface Address {
    street: string & MinLength<3>;
    city: string & MinLength<2>;
    zip: string & Pattern<typeof ZIP_REGEX>;
}

interface Customer {
    name: string & MinLength<2>;
    email: string & Email;
    address: Address;
}

const validCustomer: unknown = {
    name: 'Bob',
    email: 'bob@example.com',
    address: {
        street: 'Main Street 42',
        city: 'Berlin',
        zip: '10115',
    },
};

const invalidCustomer: unknown = {
    name: 'B',
    email: 'nope',
    address: {
        street: 'x',
        city: 'B',
        zip: 'ABCDE',
    },
};

log('Valid customer:  ', is<Customer>(validCustomer));
log('Invalid customer:', is<Customer>(invalidCustomer));

const customerErrors = validate<Customer>(invalidCustomer);
log(`Found ${customerErrors.length} errors:`);
for (const err of customerErrors) {
    log(`  -> ${err.path}: [${err.code}] ${err.message}`);
}

// ---------------------------------------------------------------------------
// 8. Union types and literal validation
// ---------------------------------------------------------------------------

log('\n=== 8. Union & Literal Types ===');

type Status = 'active' | 'inactive' | 'banned';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

log('Status "active": ', is<Status>('active'));   // true
log('Status "unknown":', is<Status>('unknown'));   // false

log('HttpMethod "GET":   ', is<HttpMethod>('GET'));     // true
log('HttpMethod "PATCH": ', is<HttpMethod>('PATCH'));   // false

type Result = { ok: true; value: string } | { ok: false; error: string };

log('Result {ok:true, value:"hi"}:', is<Result>({ ok: true, value: 'hi' }));    // true
log('Result {ok:false, error:"x"}:', is<Result>({ ok: false, error: 'x' }));   // true
log('Result {ok:true, error:"x"}: ', is<Result>({ ok: true, error: 'x' }));     // false

log('\nDone! All validation examples completed.');
