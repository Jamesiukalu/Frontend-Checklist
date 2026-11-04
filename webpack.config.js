const path = require('path');

module.exports = {
  mode: 'production',
  cache: true,
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
