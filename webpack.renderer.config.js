const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  mode: isProduction ? 'production' : 'development',
  entry: './src/renderer/index.tsx',
  // Avoid Node-style externals in the renderer; we don't use Node APIs here.
  target: 'web',
  // Enable source maps even for production builds temporarily to help debug
  // "require is not defined" by identifying the originating module.
  devtool: 'source-map',
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
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    // Explicitly disable Node built-ins so webpack doesn't emit runtime require('node:*') calls.
    fallback: {
      path: false,
      fs: false,
      os: false,
      crypto: false,
      stream: false
    }
  }
};
