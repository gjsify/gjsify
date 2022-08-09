// TODO port more tests from https://github.com/defunctzombie/node-url

import { describe, it, expect } from '@gjsify/unit';
import { fileURLToPath } from "url"

export function testSuite() {
  var fileURLToPathTestCases = [
    // Lowercase ascii alpha
    { path: '/foo', fileURL: 'file:///foo' },
    // Uppercase ascii alpha
    { path: '/FOO', fileURL: 'file:///FOO' },
    // dir
    { path: '/dir/foo', fileURL: 'file:///dir/foo' },
    // trailing separator
    { path: '/dir/', fileURL: 'file:///dir/' },
    // dot
    { path: '/foo.mjs', fileURL: 'file:///foo.mjs' },
    // space
    { path: '/foo bar', fileURL: 'file:///foo%20bar' },
    // question mark
    { path: '/foo?bar', fileURL: 'file:///foo%3Fbar' },
    // number sign
    { path: '/foo#bar', fileURL: 'file:///foo%23bar' },
    // ampersand
    { path: '/foo&bar', fileURL: 'file:///foo&bar' },
    // equals
    { path: '/foo=bar', fileURL: 'file:///foo=bar' },
    // colon
    { path: '/foo:bar', fileURL: 'file:///foo:bar' },
    // semicolon
    { path: '/foo;bar', fileURL: 'file:///foo;bar' },
    // percent
    { path: '/foo%bar', fileURL: 'file:///foo%25bar' },
    // backslash
    { path: '/foo\\bar', fileURL: 'file:///foo%5Cbar' },
    // backspace
    { path: '/foo\bbar', fileURL: 'file:///foo%08bar' },
    // tab
    { path: '/foo\tbar', fileURL: 'file:///foo%09bar' },
    // newline
    { path: '/foo\nbar', fileURL: 'file:///foo%0Abar' },
    // carriage return
    { path: '/foo\rbar', fileURL: 'file:///foo%0Dbar' },
    // latin1
    { path: '/fóóbàr', fileURL: 'file:///f%C3%B3%C3%B3b%C3%A0r' },
    // Euro sign (BMP code point)
    { path: '/€', fileURL: 'file:///%E2%82%AC' },
    // Rocket emoji (non-BMP code point)
    { path: '/🚀', fileURL: 'file:///%F0%9F%9A%80' }
  ];

  
  fileURLToPathTestCases.forEach(function (fileURLToPathTestCase) {
    describe('url.fileURLToPath(' + fileURLToPathTestCase.fileURL + ')', function () {

      it(`should return ${fileURLToPathTestCase.path} from string`, function() {
        var fromString = fileURLToPath(fileURLToPathTestCase.fileURL);
        expect(fromString).toEqual(fileURLToPathTestCase.path)
      });

      it(`should return ${fileURLToPathTestCase.path} from URL`, function() {
        var fromURL = fileURLToPath(new URL(fileURLToPathTestCase.fileURL));
        expect(fromURL).toEqual(fileURLToPathTestCase.path)
      });
    });
  });
    
  [].concat(
    'https://host/y',
    'file://host/a',
    typeof URL === 'function' ? new URL('https://host/y') : [],
    'file:///a%2F/',
    '',
    null,
    undefined,
    1,
    {},
    true
    ).forEach(function (val) {
    describe('url.fileURLToPath(' + val + ')', function () {
      it(`should throw an Error`, function() {
        expect(() => {
          fileURLToPath(val);
        }).toThrow()
      });

    });
  });
}
