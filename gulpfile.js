var gulp = require('gulp'),
    concat = require('gulp-concat'),
    concatCss = require('gulp-concat-css'),
    uglify = require('gulp-uglify'),
    minifyCss = require('gulp-minify-css'),
    rename = require('gulp-rename'),
    less = require('gulp-less'),
    watch = require('gulp-watch');
    // autoprefixer = require('gulp-autoprefixer');

var styles = [

    'css/common.css'
];

var scripts = [
    'js/app.js'
];


/*** LESS ***/
gulp.task('less', function () {
    gulp.src('public/assets/less/common.less')
        .pipe(less())
        .pipe(concatCss('common.css'))
        .pipe(gulp.dest('public/assets/css/'));
});

/*** CSS ***/
gulp.task('css', ['less'], function () {
    gulp.src(styles)
        .pipe(concatCss('bundle.css'))
        .pipe(minifyCss())
        .pipe(rename('bundle.min.css'))
        .pipe(gulp.dest('public/assets/css'));
});

/*** JS ***/
gulp.task('js', function () {
    gulp.src(scripts)
        .pipe(concat('bundle.js'))
        .pipe(uglify())
        .pipe(rename('bundle.min.js'))
        .pipe(gulp.dest('public/assets/js'));
});

/*** JS ***/


// gulp.src('css/common.css')
//     .pipe(autoprefixer({
//         browsers: ['last 2 versions'],
//         cascade: false
//     }))
//     .pipe(gulp.dest('dist'));
// );

/*** WATCH ***/
gulp.task('watch', function () {
    gulp.watch('public/assets/less/**/*.less', ['css']);
    gulp.watch(styles, ['css']);
    gulp.watch(scripts, ['js']);
});


/*** BUILD ***/
gulp.task('build', ['css', 'js']);

