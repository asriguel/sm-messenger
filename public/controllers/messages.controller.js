app
    .controller('messagesController', function ($scope, $rootScope, $uibModal, $window, $http, vkService, mailruService, toaster) {
    this.dialogs = [];
    this.messages = [];

    // init vkService
    vkService.setClientId(6033392);
	// init mailruService
	//mailruService.setClientId(754302);

    mailruService.setClientId(754302);

    let services = [vkService, mailruService];

    this.updateDialogs = () => {
		this.dialogs = [];
        services.forEach((service) => {
            if (service.connected) {
                service.getDialogs()
                    .then(dialogs => {
						console.log(`Got dialogs: ${JSON.stringify(dialogs)}`);
                        this.dialogs = this.dialogs.concat(dialogs);
                    })
                    .catch(err => toaster.pop('error', err.service, err.message));
            }
        });
		$rootScope.currentDialog = $rootScope.currentDialog || this.dialogs[0];
		console.log(`Summary dialogs after update: ${JSON.stringify(this.dialogs)}`);
		console.log(`Current dialog: ${JSON.stringify($rootScope.currentDialog)}`);
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