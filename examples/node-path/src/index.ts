import '@gjsify/node-globals';
import path from 'path';

console.log('=== @gjsify/path example ===\n');

// path.join
console.log('path.join("/usr", "local", "bin"):', path.join('/usr', 'local', 'bin'));

// path.basename
console.log('path.basename("/home/user/file.txt"):', path.basename('/home/user/file.txt'));
console.log('path.basename("/home/user/file.txt", ".txt"):', path.basename('/home/user/file.txt', '.txt'));

// path.dirname
console.log('path.dirname("/home/user/file.txt"):', path.dirname('/home/user/file.txt'));

// path.extname
console.log('path.extname("index.html"):', path.extname('index.html'));
console.log('path.extname("archive.tar.gz"):', path.extname('archive.tar.gz'));

// path.parse
console.log('path.parse("/home/user/file.txt"):', JSON.stringify(path.parse('/home/user/file.txt')));

// path.isAbsolute
console.log('path.isAbsolute("/foo"):', path.isAbsolute('/foo'));
console.log('path.isAbsolute("bar"):', path.isAbsolute('bar'));

// path.normalize
console.log('path.normalize("/foo/bar//baz/asdf/quux/.."):', path.normalize('/foo/bar//baz/asdf/quux/..'));

// path.relative
console.log('path.relative("/data/orandea/test/aaa", "/data/orandea/impl/bbb"):', path.relative('/data/orandea/test/aaa', '/data/orandea/impl/bbb'));

// path.sep and path.delimiter
console.log('path.sep:', JSON.stringify(path.sep));
console.log('path.delimiter:', JSON.stringify(path.delimiter));

console.log('\n=== path example complete ===');
