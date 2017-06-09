app
    .controller('messagesController', function ($scope, $rootScope, $uibModal, $window, $http, vkService, mailruService, slackService, toaster) {
    this.dialogs = [];
    this.messages = [];
    this.services = [ vkService, mailruService, slackService ];
		
	this.reloadCurrentDialog = () => {
		if (!$rootScope.currentDialog) {
			console.warn(`Cannot reload current dialog: no current dialog`);
			toaster.pop("error", "No current dialog", "No current dialog");
			return Promise.resolve();
		}
		return $rootScope.currentDialog.getMessages().then(messages => {
			this.messages = messages;
		}).catch(err => {
			if (err.showPopup) {
				toaster.pop("error", err.service, err.message);
			}
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
		if (service.connected) {
			return service.getDialogs();
		}
		else {
			console.log(`Service ${service.name} disconnected`);
			return Promise.resolve([]);
		}
	};
	
	this.reloadDialogList = () => {
		console.log(`Reloading dialog list`);
		return Promise.all(this.services.map(service => reloadServiceDialogs(service))).then(dialogLists => {
			console.log(`Dialogs lists: ${JSON.stringify(dialogLists)}`);
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
			if (err.showPopup) {
				toaster.pop("error", err.service, err.message);
			}
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
			const promise = $rootScope.currentDialog.sendMessage($scope.message);
			$scope.message = "";
			return promise;
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
                services: () => this.services
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