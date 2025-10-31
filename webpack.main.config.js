const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  mode: isProduction ? 'production' : 'development',
  entry: './src/main/main.ts',
  target: 'electron-main',
  devtool: isProduction ? false : 'source-map',
  externals: {
    electron: 'commonjs electron',
    path: 'commonjs path',
    fs: 'commonjs fs',
    'fs/promises': 'commonjs fs/promises',
    child_process: 'commonjs child_process',
    util: 'commonjs util'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        include: /src/,
        use: [{ loader: 'ts-loader' }]
      }
    ]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  node: {
    __dirname: false,
    __filename: false
  }
};
