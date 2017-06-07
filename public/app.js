const app = angular.module('MessengerApp', ['ui.bootstrap', 'ngCookies', 'ngTextareaEnter', 'toaster', 'ngSanitize', 'angularMoment', 'ngScrollbars']);

app.config(function ($sceDelegateProvider) {
    $sceDelegateProvider.resourceUrlWhitelist([
        'self',
        'https://api.vk.com/**',
        'https://**.vk.com/**',
		'http://appsmail.ru/**',
		'https://**.mail.ru/**',
		'http://**.mail.ru/**']);


});

app.config(function (ScrollBarsProvider) {
    ScrollBarsProvider.defaults = {

        axis: 'y', // enable 2 axis scrollbars by default
        setLeft: '-15px',
        autoHideScrollbar: true,

    };
});

app.controller("con",function($scope){
    $scope.class = "red";
    $scope.changeClass = function(){
        if ($scope.class === "red")
            $scope.class = "blue";
        else
            $scope.class = "red";
    };
});


