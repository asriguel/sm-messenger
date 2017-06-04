app
    .controller('messagesController', function ($scope, $rootScope, $uibModal, $window, $http, vkService, mailruService, toaster) {
    this.dialogs = [];
    this.messages = [];

    // init vkService
    vkService.setClientId(6033392);
	// init mailruService
    mailruService.setClientId(754302);

    let services = [ vkService, /*mailruService*/ ];
	
	this.reloadCurrentDialog = () => {
		if (!$rootScope.currentDialog) {
			console.warn(`Cannot reload current dialog: no current dialog`);
			toaster.pop("error", "No current dialog", "No current dialog");
			return Promise.resolve();
		}
		return $rootScope.currentDialog.getMessages().then(messages => {
			this.messages = messages;
		}).catch(err => {
			console.error(`Failed to reload current dialog`);
			console.log(err);
			console.log(`current dialog: ${JSON.stringify($rootScope.currentDialog)}`);
			toaster.pop("error", err.service, err.message);
		});
	};
	
	this.setCurrentDialog = dialog => {
		$rootScope.currentDialog = dialog;
		return this.reloadCurrentDialog();
	};
	
	const compareDialogs = ({ full_name: fullName1 }, { full_name: fullName2 }) => {
		const cmp = fullName1.localeCompare(fullName2);
		if (cmp < 0) {
			return -1;
		}
		else if (cmp > 0) {
			return 1;
		}
		else {
			return 0;
		}
	};
	
	const reloadServiceDialogs = service => {
		return service.connected ? service.getDialogs() : Promise.resolve([]);
	};
	
	this.reloadDialogList = () => {
		return Promise.all(services.map(service => reloadServiceDialogs(service))).then(dialogLists => {
			this.dialogs = dialogLists.reduce((dialogs, list) => {
				dialogs.push(...list);
				return dialogs;
			}, []).sort((d1, d2) => compareDialogs(d1, d2));
			if (!$rootScope.currentDialog && this.dialogs[0]) {
				return this.setCurrentDialog(this.dialogs[0]);
			}
			else {
				return Promise.resolve();
			}
		}).catch(err => {
			console.error(`Failed to reload dialog list`);
			console.log(err);
			console.log(`Current dialog: ${$rootScope.currentDialog}`);
			toaster.pop("error", err.service, err.message);
		});
	};

    this.sendMessage = () => {
		if (!$rootScope.currentDialog) {
			console.warn(`Cannot send message: no current dialog`);
			toaster.pop("error", "No current dialog", "No current dialog");
			return Promise.resolve();
		}
		else if ($scope.message == null) {
			console.warn(`Cannot send message: no message`);
			toaster.pop("error", "No message", "No message");
			return Promise.resolve();
		}
        else {
			return $rootScope.currentDialog.sendMessage($scope.message);
		}
    };

    this.addService = () => {
        $uibModal.open({
            templateUrl: 'assets/html/newServiceModal.html',
            controller: function ($scope, $uibModalInstance, services) {
                $scope.newService = '0';
                $scope.services = services;
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => {
                    $uibModalInstance.close();
                    return $scope.newService.auth();
                };
            },
            resolve: {
                services: () => services
            }
        });
    };

    $rootScope.$on("reloadCurrentDialog", () => this.reloadCurrentDialog());
	$rootScope.$on("reloadDialogList", () => this.reloadDialogList());
	$rootScope.$on("scrollBottom", () => {
        const scroller = document.getElementById("main");
        scroller.scrollTop = scroller.scrollHeight;
    });
});