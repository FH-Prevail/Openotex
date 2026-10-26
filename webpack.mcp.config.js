const path = require('path');
const webpack = require('webpack');

const isProduction = process.env.NODE_ENV === 'production';

// The MCP server is a single self-contained Node.js script. The app copies it
// to the user data folder so coding agents can start it with a stable path.
module.exports = {
  mode: isProduction ? 'production' : 'development',
  entry: './src/mcp/server.ts',
  target: 'node',
  devtool: false,
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
    filename: 'mcp-server.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  optimization: {
    // Keep the shipped script readable for people who want to inspect it.
    minimize: false
  },
  plugins: [
    new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })
  ],
  node: {
    __dirname: false,
    __filename: false
  }
};
