const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  mode: isProduction ? 'production' : 'development',
  entry: './src/renderer/index.tsx',
  target: 'electron-renderer',
  devtool: isProduction ? false : 'source-map',
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true,
    static: {
      directory: path.join(__dirname, 'public'),
    },
    allowedHosts: 'all',
    host: 'localhost',
    client: {
      overlay: {
        errors: true,
        warnings: false
      },
      webSocketURL: 'ws://localhost:3000/ws'
    }
  },
  ignoreWarnings: [
    {
      module: /latex\.js/,
      message: /Critical dependency/
    }
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        include: /src/,
        use: [{ loader: 'ts-loader' }]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.ttf$/,
        type: 'asset/resource'
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/,
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name][ext]'
        }
      }
    ]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'renderer.js',
    globalObject: 'self',
    publicPath: './'
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html'
    }),
    new MonacoWebpackPlugin({
      languages: ['json', 'markdown'],
      features: ['!codelens', '!colorPicker']
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'assets',
          to: 'assets',
          noErrorOnMissing: true
        }
      ]
    })
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx']
  }
};
