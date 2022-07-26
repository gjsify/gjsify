module.exports = {
  presets: [
    [
      "@babel/typescript",
      {
        allExtensions: true,
      },
    ],
    [
      "@babel/preset-env",
      {
        corejs: 3
      },
    ],
  ],
  plugins: [

  ],
};
