const app = angular.module('MessengerApp', ['ui.bootstrap', 'ngCookies', 'ngTextareaEnter', 'toaster', 'ngSanitize', 'angularMoment']);

app.config(function ($sceDelegateProvider) {
    $sceDelegateProvider.resourceUrlWhitelist([
        'self',
        'https://api.vk.com/**',
        'https://**.vk.com/**',
		'http://appsmail.ru/**',
		'https://**.mail.ru/**',
		'http://**.mail.ru/**']);
});