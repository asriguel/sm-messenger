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
		this.pollTimeout = 5000;

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
						message: `API method ${methodName} failed due to: ${data.error.error_msg}` 
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
				return this.$http.get(url).then(
					({ data }) => {
						if (data.failed) {
							throw {
								service: this.name,
								message: `polling failed due to: ${data.failed}`
							};
						}
						return this.processUpdates(data.updates).then(() => ts = data.ts);
					}
				);
			};
		});
	}
	
	//FIXME does not work with conversations
	processUpdate([ eventCode, ...data ]) {
		if (eventCode === this.pollEventCodes.NEW_MESSAGE) {
			console.log(`New message: ${JSON.stringify([ eventCode, ...data ])}`);
			const [ flags, messageId, peerId, timestamp, text ] = data;

			this.$rootScope.$emit("reloadDialogList");
			const { currentDialog } = this.$rootScope;
			if (currentDialog) {
				const { service, peerId: currentPeerId } = currentDialog;
				if (service === "vk" && (currentPeerId === peerId || peerId === this.$rootScope.vk.id)) {
					this.$rootScope.$emit("reloadCurrentDialog");
				}
			}
			return {
				peerId,
				text
			};
		}
	}
	
	processUpdates(updates) {
		const updateDataArray = updates.map(update => this.processUpdate(update)).filter(data => data != null);
		const user_ids = updateDataArray.map(({ peerId }) => peerId);
		return this.callApiMethod("users.get", { user_ids: user_ids.join(",") }).then(
			({ response: users }) => {
				users.forEach((user, i) => {
					this.toaster.pop("success", `${user.first_name} ${user.last_name}`, updateDataArray[i].text);
				});
			}
		);
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
			this.$rootScope.$emit("reloadDialogList");
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
	
	getMessage(item, user) {
		return {
			text: item.body,
			date: new Date(item.date * 1000),
			from_id: item.from_id,
			full_name: `${user.first_name} ${user.last_name}`,
			photo: user.photo_50
		};
	}
	
	getDialogMessages(dialog) {
		return this.callApiMethod("messages.getHistory", { user_id: dialog.id }).then(
			({ response }) => {
				console.log(`Got dialog messages: ${response}`);
				response.shift();
				const user_ids = response.map(item => item.from_id);
				return this.callApiMethod("users.get", { user_ids: user_ids.join(","), fields: "photo_50" }).then(
					({ response: users }) => {
						return users.map((user, i) => this.getMessage(response[i], user));
					}
				);
			}
		);
	}
	
	sendDialogMessage(dialog, message) {
		const peerName = dialog.type === 1 ? "user_id" : "chat_id";
		return this.callApiMethod("messages.send", { message, [ peerName ]: dialog[peerName] });
	}
	
	getDialog(item, user) {
		const dialog = {
			service: "vk",
			text: item.body,
			unread: !item.read_state,
			date: newDate(item.date * 1000),
			type: item.chat_id ? 2 : 1,
			id: item.chat_id ? item.chat_id : item.user_id,
			chat_title: item.chat_id ? item.title : undefined,
			full_name: `${user.first_name} ${user.last_name}`,
			photo: user.photo_50,
			getMessages: () => this.getDialogMessages(dialog),
			sendMessage: message => this.sendDialogMessage(dialog, message)
		};
		return dialog;
	}
	
	getDialogs() {
		return this.callApiMethod("messages.getDialogs").then(
			({ response }) => {
				response.shift();
				const user_ids = response.map(item => item.chat_id ? item.chat_id : item.user_id);
				return this.callApiMethod("users.get", { user_ids: user_ids.join(","), fields: "photo_50" }).then(
					({ response: users }) => {
						return users.map((user, i) => this.getDialog(response[i], user));
					}
				);
			}
		);
	}
}

app.service('vkService', VkService);