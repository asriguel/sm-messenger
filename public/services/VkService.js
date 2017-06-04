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
		this.authURL = "https://oauth.vk.com/authorize";
		this.authRedirectURI = "https://oauth.vk.com/blank.html&scope=messages&response_type=token";
		
		this.pollConfig = {
			act: "a_check",
			wait: 25,
			mode: 2,
			version: 2
		};
		this.pollEventCodes = {
			NEW_MESSAGE: 4
		};
		this.pollTimeout = 1000;

        if ($cookies.get('vk_token')) {
            this.connect($cookies.get('vk_token'));
        }
    }

    setClientId(clientId) {
        this.clientId = clientId;
    }
	
	callApiMethod(methodName, params) {
		const url = super.buildRequestURL(
			`${this.apiURL}/${methodName}`,
			Object.assign({}, params, { access_token: this.token })
		);
		return this.$http.jsonp(url).then(
			({ data }) => {
				if (data.error) {
					throw {
						service: this.name,
						message: `API method ${methodName} failed due to: ${data.error.err_msg}` 
					};
				}
				return data;
			}
		);
	}
	
	makePoller() {
		return this.callApiMethod("messages.getLongPollServer").then(({ response: { ts, key, server } }) => {
			return () => {
				const url = super.buildRequestURL(
					`https://${server}`,
					Object.assign({}, this.pollConfig, { ts, key })
				);
				console.log(`Polling URL: ${url}`);
				return this.$http.get(url).then(
					({ data }) => {
						if (data.failed) {
							throw {
								service: this.name,
								message: `polling failed due to: ${data.failed}`
							};
						}
						console.log(`Polled data: ${JSON.stringify(data)}`);
						return this.processUpdates(data.updates).then(() => ts = data.ts);
					}
				);
			};
		});
	}
	
	//FIXME does not work with conversations
	processUpdate([ eventCode, ...data ]) {
		if (eventCode === this.pollEventCodes.NEW_MESSAGE) {
			const [ flags, messageId, peerId, timestamp, text ] = data;

			this.$rootScope.$emit("reloadDialogList");
			const { currentDialog } = this.$rootScope;
			if (currentDialog) {
				const { service, peerId: currentPeerId } = currentDialog;
				if (service === "vk" && (currentPeerId === peerId || peerId === this.$rootScope.vk.id)) {
					this.$rootScope.$emit("reloadCurrentDialog");
				}
			}
			
			return this.callApiMethod("users.get", { user_ids: peerId }).then(
				({ response: [ { first_name, last_name } ] }) => {
					this.toaster.pop("success", `${first_name} ${last_name}`, text);
				}
			);
		}
	}
	
	processUpdates(updates) {
		return Promise.all(updates.map(update => this.processUpdate(update)));
	}
	
	initPoller() {
		return this.makePoller().then(poller => {
			setInterval(() => poller(), this.pollTimeout);
		});
	}

    connect(token) {
        this.token = token;
        this.connected = true;
		return this.callApiMethod("users.get", { fields: "photo_50" }).then(({ response: [ user ] }) => {
			this.$rootScope.vk = {
				id: user.uid,
				full_name: user.first_name + ' ' + user.last_name,
				photo: user.photo
			};
			console.log(`Connect successful: ${JSON.stringify(this.$rootScope.vk)}`);
			return this.initPoller();
		});
    }

    auth() {
		const requestURL = super.buildRequestURL(this.authURL, {
			client_id: this.clientId,
			display: "page",
			redirect_uri: this.authRedirectURI
		});
        this.$window.open(requestURL, '_blank');
        let authModal = this.$uibModal.open({
            templateUrl: 'assets/html/vkAuthModal.html',
            controller: function ($scope, $uibModalInstance) {
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => $uibModalInstance.close($scope.token);
            }
        });
        return authModal.result.then(token => {
			console.log(`Authorization VK successful: token=${token}`);
			this.$cookies.put('vk_token', token);
			return this.connect(token);
		});
    }
	
	getMessage(item) {
		const { from_id, date, body } = item;
		const message = {
			text: body,
			date: new Date(date * 1000),
			from_id
		};
		return this.callApiMethod("users.get", { user_ids: from_id, fields: "photo_50" }).then(
			({ response: [ user ] }) => {
				message.full_name = `${user.first_name} ${user.last_name}`;
				message.photo = user.photo_50;
				return message;
			}
		);
	}
	
	getDialogMessages(dialog) {
		return this.callApiMethod("messages.getHistory", { user_id: dialog.id }).then(
			({ response: { items } }) => {
				return Promise.all(items.map(item => this.getMessage(item)));
			}
		);
	}
	
	sendDialogMessage(dialog, message) {
		const peerName = dialog.type === 1 ? "user_id" : "chat_id";
		return this.callApiMethod("messages.send", { message, [ peerName ]: dialog[peerName] });
	}

	getDialog(item) {
		const { body, read_state, date } = item;
		const dialog = {
			service: "vk",
			text: body,
			unread: !read_state,
			date: new Date(date * 1000),
			type: item.chat_id ? 2 : 1,
			id: dialog.chat_id ? item.chat_id : item.user_id
		};
		if (item.chat_id) {
			dialog.chat_title = item.title;
		}
		return this.callApiMethod("users.get", { user_ids: dialog.id, fields: "photo_50" }).then(
			({ response: [ user ] }) => {
				dialog.full_name = `${user.first_name} ${user.last_name}`;
				dialog.photo = user.photo_50;
				dialog.getMessages = () => this.getDialogMessages(dialog);
				dialog.sendMessage = (message) => this.sendDialogMessage(dialog, message);
				return dialog;
			}
		);
	}
	
	getDialogs() {
		return this.callApiMethod("messages.getDialogs").then(
			({ response: { items } }) => Promise.all(items.map(item => this.getDialog(item)))
		);
	}
}

app.service('vkService', VkService);