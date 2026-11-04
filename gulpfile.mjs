import fs from 'node:fs';
import path from 'node:path';
import {finished} from 'node:stream/promises';
import {createRequire} from 'node:module';

import gulp from 'gulp';
import gulpIf from 'gulp-if';
import plumber from 'gulp-plumber';
import rename from 'gulp-rename';
import cached from 'gulp-cached';

import * as dartSass from 'sass';
import gulpSass from 'gulp-sass';
import postcss from 'gulp-postcss';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import sortMediaQueries from 'postcss-sort-media-queries';
import Beasties from 'beasties';
import {Transform} from 'node:stream';

import pug from 'gulp-pug';
import data from 'gulp-data';
import {minify as minifyHtml} from 'html-minifier-terser';

import webpack from 'webpack';
import webpackStream from 'webpack-stream';

import sharp from 'sharp';
import {optimize as optimizeSvg} from 'svgo';

import browserSyncLib from 'browser-sync';
import modernizr from 'modernizr';
import {deleteAsync} from 'del';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';

const require = createRequire(import.meta.url);
const webpackConfig = require('./webpack.config.js');
const modernizrConfig = require('./modernizr-config.json');

const sass = gulpSass(dartSass);
const browserSync = browserSyncLib.create();
const argv = yargs(hideBin(process.argv)).argv;

// ========================================
// VARIABLES
// ========================================

const dataFolder = './data';

const langs = fs
  .readdirSync(dataFolder)
  .filter((file) => fs.statSync(path.join(dataFolder, file)).isDirectory());

const lang = argv.l === undefined ? 'en' : argv.l; // Default language

const dirs = {
  src: 'src',
  dest: 'dist',
};

const sassPaths = {
  src: `${dirs.src}/styles/main.scss`,
  dest: `${dirs.dest}/styles/`,
};

const isDevelopment =
  !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

// Only keep the process alive on errors while watching; builds must fail
const isWatching = !argv._.length || argv._.includes('dev');

const onError = function onError(error) {
  console.error(error.toString());
  this.emit('end');
};

const plumberOptions = {errorHandler: isWatching ? onError : false};

const loadProjectData = (l) =>
  JSON.parse(fs.readFileSync(`./data/${l}/_project.json`, 'utf8'));

// Waits for every stream so the gulp task only completes once all are written
const allStreams = (streams) => Promise.all(streams.map((s) => finished(s)));

// Wraps an async (file) => Buffer function as a vinyl transform stream
const mapContents = (fn) =>
  new Transform({
    objectMode: true,
    async transform(file, _enc, cb) {
      try {
        if (file.isBuffer()) file.contents = await fn(file);
        cb(null, file);
      } catch (error) {
        cb(error);
      }
    },
  });

// ========================================
// PUG / HTML
// ========================================

export function compilePug() {
  return gulp
    .src(`${dirs.src}/views/index-${lang}.pug`)
    .pipe(plumber(plumberOptions))
    .pipe(data(() => loadProjectData(lang)))
    .pipe(pug({locals: {}, pretty: true}))
    .pipe(rename({basename: 'index'}))
    .pipe(gulp.dest(dirs.dest))
    .pipe(browserSync.stream());
}

export function compileAllPug() {
  return allStreams(
    langs.map((l) =>
      gulp
        .src(`${dirs.src}/views/index-${l}.pug`)
        .pipe(data(() => loadProjectData(l)))
        .pipe(pug({locals: {}, pretty: true}))
        .pipe(gulp.dest(dirs.dest)),
    ),
  );
}

// ========================================
// CSS
// ========================================

export function compileStyles() {
  const sassStream = sass.sync({
    // Legacy SCSS relies on @import and slash division
    silenceDeprecations: ['import', 'global-builtin', 'slash-div'],
    quietDeps: true,
  });
  if (isWatching) sassStream.on('error', sass.logError);

  return gulp
    .src(sassPaths.src, {sourcemaps: isDevelopment})
    .pipe(plumber(plumberOptions))
    .pipe(sassStream)
    .pipe(postcss([autoprefixer(), sortMediaQueries(), cssnano()]))
    .pipe(rename({suffix: '.min'}))
    .pipe(gulp.dest(sassPaths.dest, {sourcemaps: isDevelopment ? '.' : false}))
    .pipe(browserSync.stream());
}

// Inline the CSS the page needs and load the rest asynchronously
const beasties = new Beasties({
  path: dirs.dest,
  publicPath: '/',
  preload: 'swap',
  logLevel: 'warn',
});

const minifyPage = (html) =>
  minifyHtml(html, {collapseWhitespace: true, removeComments: true});

export function criticalCss() {
  return allStreams(
    langs.map((l) =>
      gulp
        .src(`${dirs.dest}/index-${l}.html`)
        .pipe(
          mapContents(async (file) =>
            Buffer.from(
              await minifyPage(await beasties.process(file.contents.toString())),
            ),
          ),
        )
        .pipe(rename({basename: 'index'}))
        .pipe(gulp.dest(l === 'en' ? dirs.dest : `${dirs.dest}/${l}`)),
    ),
  );
}

// ========================================
// JAVASCRIPT
// ========================================

export function webpackScripts() {
  return gulp
    .src(`${dirs.src}/scripts/main.js`)
    .pipe(plumber(plumberOptions))
    .pipe(webpackStream(webpackConfig, webpack))
    .pipe(gulp.dest(`${dirs.dest}/scripts/`))
    .pipe(browserSync.stream());
}

// ========================================
// IMAGES
// ========================================

const optimizeImage = async (file) => {
  const ext = path.extname(file.path).toLowerCase();
  const input = file.contents;
  switch (ext) {
    case '.webp':
      return sharp(input).webp({quality: 70}).toBuffer();
    case '.jpg':
    case '.jpeg':
      return sharp(input).jpeg({mozjpeg: true, progressive: true}).toBuffer();
    case '.png':
      return sharp(input).png({compressionLevel: 9, effort: 10}).toBuffer();
    case '.svg':
      return Buffer.from(
        optimizeSvg(input.toString(), {path: file.path}).data,
      );
    default:
      return input;
  }
};

// Keeps the original when optimizing would make the file larger
const smallest = (fn) => async (file) => {
  const optimized = await fn(file);
  return optimized.length < file.contents.length ? optimized : file.contents;
};

export function compressWebp() {
  return gulp
    .src(`${dirs.src}/img/**/*.webp`, {encoding: false})
    .pipe(mapContents(smallest(optimizeImage)))
    .pipe(gulp.dest(`${dirs.dest}/img/`));
}

export const compressImages = gulp.series(compressWebp, function images() {
  return gulp
    .src(`${dirs.src}/img/**/*.{jpg,png,svg}`, {encoding: false})
    .pipe(cached('images'))
    .pipe(mapContents(smallest(optimizeImage)))
    .pipe(gulp.dest(`${dirs.dest}/img/`));
});

// ========================================
// SERVER
// ========================================

export function serve(done) {
  browserSync.init({
    server: {baseDir: './dist', index: 'index.html'},
    notify: false,
    open: true,
  });
  done();
}

// ========================================
// MISC
// ========================================

const cdnFiles = [
  '/scripts/app.bundle.js',
  '/styles/main.min.css',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon.png',
  '/browserconfig.xml',
  '/service-worker.js',
  '/safari-pinned-tab.svg',
  '/manifest.json',
  '/img/social/facebook-banner.jpg',
  '/img/logos/logo-front-end-checklist.jpg',
  '/img/logos/logo-front-end-checklist.webp',
];

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rewrites asset URLs to a CDN. Opt in with CDN_BASE (e.g. //cdn.example.com)
export function cdn(done) {
  const base = process.env.CDN_BASE;
  if (!base) return done();

  const pattern = new RegExp(
    `(=\\s*["'])(${cdnFiles.map(escapeRegExp).join('|')})(?=["'?#])`,
    'g',
  );

  return allStreams(
    langs.map((l) =>
      gulp
        .src(`./dist/index-${l}.html`)
        .pipe(
          mapContents(async (file) =>
            Buffer.from(
              file.contents.toString().replace(pattern, `$1${base}$2`),
            ),
          ),
        )
        .pipe(gulp.dest(dirs.dest)),
    ),
  );
}

export const cleanDist = () => deleteAsync(['./dist'], {force: true});

// Merges JSON files into one object keyed by file name (without extension)
const concatJson = (files) =>
  files.reduce((acc, file) => {
    acc[path.basename(file, '.json')] = JSON.parse(
      fs.readFileSync(file, 'utf8'),
    );
    return acc;
  }, {});

const jsonFilesIn = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));

function rebuildJson(l) {
  const base = `./data/${l}`;
  fs.writeFileSync(
    `${base}/_items.json`,
    JSON.stringify(concatJson(jsonFilesIn(`${base}/items`))),
  );
  fs.writeFileSync(
    `${base}/_project.json`,
    JSON.stringify(
      concatJson([`${base}/_items.json`, ...jsonFilesIn(`${base}/project`)]),
    ),
  );
}

export function jsonRebuild(done) {
  rebuildJson(lang);
  browserSync.reload();
  done();
}

export function jsonRebuildAll(done) {
  langs.forEach(rebuildJson);
  done();
}

export function copy() {
  return gulp
    .src(
      [
        `${dirs.src}/*.*`,
        `${dirs.src}/_headers`,
        `!${dirs.src}/modernizr-custom.min.js`,
      ],
      {dot: true, encoding: false},
    )
    .pipe(gulp.dest(dirs.dest));
}

export function modernizrBuild(done) {
  modernizr.build(modernizrConfig, (code) => {
    fs.writeFile(`${dirs.src}/modernizr-custom.min.js`, code, done);
  });
}

// ========================================
// TASKS
// ========================================

export function watch() {
  gulp.watch(`${dirs.src}/styles/**/*.scss`, compileStyles);
  gulp.watch(`${dirs.src}/views/**/*.pug`, compilePug);
  gulp.watch(
    [`./data/${lang}/items/*.json`, `./data/${lang}/project/*.json`],
    gulp.series(jsonRebuild, compilePug),
  );
  gulp.watch(`${dirs.src}/img/**/*`, compressImages);
  gulp.watch(`${dirs.src}/scripts/**/*.js`, webpackScripts);
}

export const dev = gulp.series(
  jsonRebuild,
  gulp.parallel(compilePug, compileStyles, compressImages, webpackScripts),
  serve,
  watch,
);

export const build = gulp.series(
  gulp.parallel(cleanDist, jsonRebuildAll, modernizrBuild),
  compileAllPug,
  gulp.parallel(compileStyles, compressImages, webpackScripts),
  cdn,
  gulp.parallel(criticalCss, copy),
);

export default gulp.series(serve, watch);
