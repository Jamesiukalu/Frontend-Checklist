const path = require('path');

module.exports = {
  mode: 'production',
  cache: true,
  // Ship a source map: the code is MIT-licensed and public on GitHub, and
  // production debugging without one is guesswork.
  devtool: 'source-map',
  entry: {
    app: path.resolve(__dirname, 'src/scripts', 'main.js'),
  },
  output: {
    filename: '[name].bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
      },
    ],
  },
};
