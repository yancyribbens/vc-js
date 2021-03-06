/**
 * vc-js webpack build rules.
 *
 * @author Digital Bazaar, Inc.
 *
 * Copyright 2017 Digital Bazaar, Inc.
 */
const path = require('path');
const webpack = require('webpack');
const webpackMerge = require('webpack-merge');

// build multiple outputs
module.exports = [];

// custom setup for each output
// all built files will export the "vc-js" library but with different content
const outputs = [
  // core vc-js library
  {
    entry: [
      // 'babel-polyfill' is very large, list features explicitly
      'regenerator-runtime/runtime',
      'core-js/fn/array/includes',
      'core-js/fn/object/assign',
      'core-js/fn/promise',
      'core-js/fn/symbol',
      // main lib
      './lib/index.js'
    ],
    filenameBase: 'vc-js'
  },
  /*
  // core vc-js library + extra utils and networking support
  {
    entry: ['./lib/index.all.js'],
    filenameBase: 'vc-js.all'
  }
  */
  // custom builds can be created by specifying the high level files you need
  // webpack will pull in dependencies as needed
  // Note: if using UMD or similar, add main js *last* to properly export
  // the top level namespace.
  //{
  //  entry: ['./lib/FOO.js', ..., './lib/...js'],
  //  filenameBase: 'vc-js.custom'
  //  libraryTarget: 'umd'
  //}
];

outputs.forEach((info) => {
  // common to bundle and minified
  const common = {
    // each output uses the main name but with different contents
    entry: {
      'vc-js': info.entry
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          include: [{
            // exclude node_modules by default
            exclude: /(node_modules)/
          }, {
            // include rdf-canonize
            include: /(node_modules\/rdf-canonize)/
          }],
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['env'],
              plugins: [
                ['transform-object-rest-spread', {useBuiltIns: true}]
              ]
            }
          }
        }
      ]
    },
    plugins: [
      //new webpack.DefinePlugin({
      //}),
    ],
    // disable various node shims handled manually
    /*
    node: {
      Buffer: false,
      crypto: false,
      process: false,
      setImmediate: false
    }
    */
  };

  // plain unoptimized unminified bundle
  const bundle = webpackMerge(common, {
    output: {
      path: path.join(__dirname, 'dist'),
      filename: info.filenameBase + '.js',
      library: info.library || '[name]',
      libraryTarget: info.libraryTarget || 'umd'
    }
  });
  if(info.library === null) {
    delete bundle.output.library;
  }
  if(info.libraryTarget === null) {
    delete bundle.output.libraryTarget;
  }

  // optimized and minified bundle
  const minify = webpackMerge(common, {
    output: {
      path: path.join(__dirname, 'dist'),
      filename: info.filenameBase + '.min.js',
      library: info.library || '[name]',
      libraryTarget: info.libraryTarget || 'umd'
    },
    devtool: 'cheap-module-source-map',
    plugins: [
      new webpack.optimize.UglifyJsPlugin({
        compress: {
          warnings: true
        },
        output: {
          comments: false
        }
        //beautify: true
      })
    ]
  });
  if(info.library === null) {
    delete minify.output.library;
  }
  if(info.libraryTarget === null) {
    delete minify.output.libraryTarget;
  }

  module.exports.push(bundle);
  module.exports.push(minify);
});
