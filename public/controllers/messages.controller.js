app
    .controller('messagesController', function ($scope, $rootScope, $uibModal, $window, $http, vkService, mailruService, toaster) {
    this.dialogs = [];
    this.messages = [];

    // init vkService
    vkService.setClientId(6033392);

    mailruService.setClientId(754302);

    let services = [vkService, mailruService];

    this.updateDialogs = () => {
        services.forEach((service) => {
            if (service.connected) {
                service.getDialogs()
                    .then(dialogs => {
                        this.dialogs = [];
                        this.dialogs = this.dialogs.concat(dialogs);
                    })
                    .catch(err => toaster.pop('error', err.service, err.message));
            }
        });
    };
    this.updateDialogs();

    $rootScope.$on('updateDialogs', this.updateDialogs);

    $rootScope.$on('scrollBottom', () => {
        var scroller = document.getElementById("main");
        scroller.scrollTop = scroller.scrollHeight;
    });

    this.textareaAction = () => {
        $rootScope.currentDialog.sendMessage($scope.message);
    };

    this.addService = () => {
        $uibModal.open({
            templateUrl: 'assets/html/newServiceModal.html',
            controller: function ($scope, $uibModalInstance, services) {
                $scope.newService = '0';
                $scope.services = services;
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => {
                    $scope.newService.auth();
                    $uibModalInstance.close();
                };
            },
            resolve: {
                services: () => services
            }
        });
    };

    this.rerenderMessages = (dialog) => {
        $rootScope.currentDialog = dialog;
        this.messages = [];

        dialog.getMessages()
            .then(messages => {
                this.messages = messages;
            })
            .catch(err => toaster.pop('error', err.service, err.message));
    };

    $rootScope.$on('rerenderMessages', () => this.rerenderMessages($rootScope.currentDialog));
});