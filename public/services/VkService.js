class VkService extends BaseService {
    constructor($rootScope, $window, $uibModal, $http, $cookies, toaster, $timeout) {
        super('VKontakte');
        this.$window = $window;
        this.$uibModal = $uibModal;
        this.$http = $http;
        this.$rootScope = $rootScope;
        this.$cookies = $cookies;
        this.toaster = toaster;
        this.$timeout = $timeout;
		
		this.apiURL = "https://api.vk.com/method";
		this.pollTimeout = 1000;

        if ($cookies.get('vk_token')) {
            this.connect($cookies.get('vk_token'));
        }
    }

    setClientId(clientId) {
        this.clientId = clientId;
    }
	
	makeRequestString(params, withToken) {
		params = params || {};
		withToken = withToken == null ? true : Boolean(withToken);
		const request = Object.assign({}, params, withToken ? { access_token: this.token } : {});
		return Object.keys(request).map(key => `${key}=${request[key]}`).join("&");
	}
	
	callApiMethod(methodName, params) {
		const requestString = this.makeRequestString(params);
		const url = `${this.apiURL}/${methodName}?${requestString}`;
		return this.$http.jsonp(url);
	}
	
	poll(ts, server, key) {
		const requestString = this.makeRequestString({ act: "a_check", key, ts, wait: 25, mode: 2, version: 1 });
		const url = `https://${server}?${requestString}`;
		return this.$http.get(url).then(response => {
			response.data.updates.forEach(update => {
				if (update[0] == 4) {
					if (update[2] != 35 && update[3] != this.$rootScope.vk.id) {
						this.callApiMethod("users.get", { user_ids: update[3] })
							.then(([ { first_name, last_name } ]) => {
								console.log(`Poll update VK: first_name=${first_name}, last_name=${last_name}`);
								this.toaster.pop('success', first_name + ' ' + last_name, update[6]);
							});
						
						if (this.$rootScope.currentDialog && this.$rootScope.currentDialog.service === "vk") {
							console.log(`Current dialog belongs to VK`);
							const { type } = this.$rootScope.currentDialog;
							let idName;
							if (type == "1") {
								idName = "user_id";
							}
							else if (type == "2") {
								idName = "chat_id";
							}
							const id = this.$rootScope.currentDialog[idName];
							if (id == update[3]) {
								console.log(`Rerendering current VK dialog`);
								this.$rootScope.$emit('rerenderMessages');
								this.$rootScope.$emit('scrollBottom');
							}
						}
					}
					this.$rootScope.$emit('updateDialogs');
				}
			});
			return response.data.ts;
		}).catch(err => {
			console.log(`Poll failed:`);
			console.log(err);
		});
	}

    connect(token) {
        this.token = token;
        this.connected = true;
        this.$rootScope.$emit('updateDialogs');

		this.callApiMethod("users.get", { "fields": "photo_50" })
            .then(response => {
                if (response.data.error) {
                    this.$cookies.remove('vk_token');
                    throw {service: 'VKontakte', message: response.data.error.error_msg};
                }

                const user = response.data.response[0];
				console.log(`VK user: ${JSON.stringify(user)}`);
                this.$rootScope.vk = {
					id: user.uid,
					full_name: user.first_name + ' ' + user.last_name,
					photo: user.photo
				};
            })
            .catch(err => this.toaster.pop('error', err.service, err.message));

        this.callApiMethod("messages.getLongPollServer")
            .then(response => {
				let { ts, server, key } = response;
                setInterval(() => {
					this.poll(ts, server, key).then(newTs => ts = newTs);
				}, this.pollTimeout);
            })
            .catch(err => {
				console.log(`VK getLongPollServer failed:`);
				console.log(err);
				this.toaster.pop('error', err.service, err.message);
			});
    }

    auth() {
		const authURL = "https://oauth.vk.com/authorize";
		const requestString = this.makeRequestString({
			client_id: this.clientId,
			display: "page",
			redirect_uri: "https://oauth.vk.com/blank.html&scope=messages&response_type=token"
		}, false);
		const url = `${authURL}?${requestString}`;
        this.$window.open(url, '_blank');
        let authModal = this.$uibModal.open({
            templateUrl: 'assets/html/vkAuthModal.html',
            controller: function ($scope, $uibModalInstance) {
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => $uibModalInstance.close($scope.token);
            }
        });
        authModal.result
            .then((token) => {
				console.log(`Authorization VK successful: token=${token}`);
                this.$cookies.put('vk_token', token);
                this.connect(token);
            });
    }

    getDialogs() {
        return this.callApiMethod("messages.getDialogs")
            .then(response => {
                if (response.data.error) {
					console.error(`Failed to get dialogs VK: ${JSON.stringify(response.data.error)}`);
                    this.$cookies.remove('vk_token');
                    throw {service: 'VKontakte', message: response.data.error.error_msg};
                }

                let dialogs = [];
                let user_ids = [];
                response.data.response.forEach((dialog) => {
                    if (typeof(dialog) == 'number') return;

                    let newDialog = {
                        service: 'vk',
                        text: dialog.body,
                        unread: dialog.read_state ? false : true,
                        date: new Date(dialog.date * 1000),
                        user_id: dialog.uid
                    };

                    if (dialog.chat_id) {
                        newDialog.type = '2'; // conversation
                        newDialog.chat_title = dialog.title;
                        newDialog.chat_id = dialog.chat_id;
                    } else {
                        newDialog.type = '1'; // dialog
                    }

                    dialogs.push(newDialog);
                    user_ids.push(dialog.uid);
                });

				return Promise.all([ this.callApiMethod("uses.get", { user_ids: user_ids.join(","), fields: "photo_50" }), dialogs ]);
            })
            .then(([usersData, dialogs]) => {
                dialogs.forEach(dialog => {
                    let user = usersData.data.response.find(user => user.uid == dialog.user_id);
                    dialog.full_name = user.first_name + ' ' + user.last_name;
                    dialog.photo = user.photo_50;
                    dialog.getMessages = (offset) => {
						const idName = dialog.type == "1" ? "user_id" : "chat_id";
						return this.callApiMethod("messages.getHistory", { [ idName ]: dialog[idName] })
                            .then(response => {
                                if (response.data.error) {
									console.error(`Failed to get history VK: ${JSON.stringify(response.data.error)}`);
                                    this.$cookies.remove('vk_token');
                                    throw {service: 'VKontakte', message: response.data.error.error_msg};
                                }

                                let user_ids = [];
                                let messages = [];
                                response.data.response.forEach((message) => {
                                    if (typeof(message) == 'number') return;

                                    let photo = '';
                                    let full_name = '';

                                    if (message.from_id == this.$rootScope.vk.id) {
                                        full_name = this.$rootScope.vk.full_name;
                                        photo = this.$rootScope.vk.photo;
                                    } else if (message.from_id == user.uid) {
                                        full_name = dialog.full_name;
                                        photo = user.photo_50;
                                    } else user_ids.push(message.from_id);

                                    messages.push({
                                        text: message.body,
                                        date: new Date(message.date * 1000),
                                        photo: photo,
                                        full_name: full_name,
                                        from_id: message.from_id
                                    });
                                });

								return Promise.all([
									user_ids.length ? this.callApiMethod("users.get", { user_ids: user_ids.join(","), fields: "photo_50" }) : false,
									messages
								]);
                            })
                            .then(([usersData, messages]) => {
                                if (usersData) {
                                    messages.forEach(message => {
                                        if (message.full_name == '' || message.photo == '') {
                                            let user = usersData.data.response.find(user => user.uid == message.from_id);
                                            message.full_name = user.first_name + ' ' + user.last_name;
                                            message.photo = user.photo_50;
                                        }
                                    });
                                }

                                return messages.reverse();
                            });
                    };
					
                    dialog.sendMessage = (message) => {
						const idName = dialog.type == "1" ? "user_id" : "chat_id";
						this.callApiMethod("messages.send", { message, [ idName ]: dialog[idName] });
                    };
                });

                return dialogs;
            });
    }
}

app.service('vkService', VkService);