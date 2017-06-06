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
		this.apiVersion = "5.65";
		
		this.authURL = "https://oauth.vk.com/authorize";
		this.authConfig = {
			redirect_uri: "https://oauth.vk.com/blank.html",
			scope: "messages",
			response_type: "token",
			display: "page"
		};
		
		this.pollConfig = {
			act: "a_check",
			wait: 25,
			mode: 2,
			version: 2
		};
		this.pollEventCodes = {
			NEW_MESSAGE: 4
		};
		this.messageFlags = {
			UNREAD: 1 << 0,
			OUTBOX: 1 << 1,
			CHAT: 1 << 4
		};
		this.chatOffset = 2000000000;
		
		this.pollTimeout = 5000;

        if ($cookies.get("vk_token")) {
            this.connect($cookies.get("vk_token"));
        }
    }

    setClientId(clientId) {
        this.clientId = clientId;
    }
	
	callApiMethod(methodName, params) {
		const url = super.buildRequestURL(
			`${this.apiURL}/${methodName}`,
			Object.assign({}, params, { access_token: this.token, v: this.apiVersion })
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
	
	processUpdate([ eventCode, ...data ]) {
		if (eventCode === this.pollEventCodes.NEW_MESSAGE) {
			console.log(`New message: ${JSON.stringify([ eventCode, ...data ])}`);
			const [ flags, messageId, peerId, timestamp, text, extra ] = data;
			console.log(`Flags: ${JSON.stringify(flags)}`);
			console.log(`Peer: ${JSON.stringify(peerId)}`);
			console.log(`Extra: ${JSON.stringify(extra)}`);
			const isChat = Boolean(flags & this.messageFlags.CHAT);
			this.$rootScope.$emit("reloadDialogList");
			const { currentDialog } = this.$rootScope;
			if (currentDialog) {
				const { service, type } = currentDialog;
				if (service === "vk") {
					const isCurrentChat = type === 2;
					console.log(`Current chat: ${isCurrentChat}`);
					console.log(`Current user_id: ${currentDialog.user_id}`);
					console.log(`Current peer id: ${peerId}`);
					if (isChat === isCurrentChat) {
						if (
							(isChat && currentDialog.chat_id + this.chatOffset === peerId) ||
							(!isChat && currentDialog.user_id === peerId)
						) {
							console.log(`Reloading current dialog...`);
							this.$rootScope.$emit("reloadCurrentDialog");
						}
					}
				}
			}
			if (!(flags & this.messageFlags.OUTBOX) && (flags & this.messageFlags.UNREAD)) {
				return {
					fromId: isChat ? extra.from : peerId,
					text
				};
			}
		}
	}
	
	processUpdates(updates) {
		const updateDataArray = updates.map(update => this.processUpdate(update)).filter(data => data != null);
		console.log(`Updates: ${JSON.stringify(updateDataArray)}`);
		if (updateDataArray.length === 0) {
			return Promise.resolve();
		}
		const userIds = updateDataArray.map(({ fromId }) => fromId);
		return this.callApiMethod("users.get", { user_ids: userIds.join(",") }).then(
			({ response: users }) => {
				updateDataArray.forEach(({ fromId, text }) => {
					const { first_name, last_name } = users.find(user => user.id === fromId);
					const fullName = `${first_name} ${last_name}`;
					this.toaster.pop("success", fullName, text);
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
				id: user.id
			};
			console.log(`Connect successful: ${JSON.stringify(this.$rootScope.vk)}`);
			this.$rootScope.$emit("reloadDialogList");
			return this.initPoller();
		}).catch(err => {
			this.$cookies.remove("vk_token");
			throw err;
		});
    }

    auth() {
		const requestURL = super.buildRequestURL(
			this.authURL,
			Object.assign({}, this.authConfig, { client_id: this.clientId })
		);
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
			this.$cookies.put("vk_token", token);
			return this.connect(token);
		});
    }
	
	getMessage(message, user) {
		const msg = {
			text: message.body,
			date: new Date(message.date * 1000),
			from_id: message.from_id,
			full_name: `${user.first_name} ${user.last_name}`,
			photo: user.photo_50
		};
		return msg;
	}
	
	getDialogMessages(dialog) {
		const peerId = dialog.type === 1 ? dialog.user_id : this.chatOffset + dialog.chat_id;
		return this.callApiMethod("messages.getHistory", { peer_id: peerId }).then(
			({ response: { items } }) => {
				items = items.reverse();
				const userIds = items.map(item => item.from_id);
				if (userIds.length === 0) {
					return [];
				}
				return this.callApiMethod("users.get", { user_ids: userIds.join(","), fields: "photo_50" }).then(
					({ response: users }) => {
						return items.map(item => {
							const user = users.find(user => user.id === item.from_id);
							return this.getMessage(item, user);
						});
					}
				);
			}
		);
	}
	
	sendDialogMessage(dialog, message) {
		const peerName = dialog.type === 1 ? "user_id" : "chat_id";
		return this.callApiMethod("messages.send", { message, [ peerName ]: dialog[peerName] });
	}
	
	getDialog(message, user) {
		const dialog = {
			service: "vk",
			text: message.body,
			unread: !message.read_state,
			date: new Date(message.date * 1000),
			type: message.chat_id ? 2 : 1,
			from_id: message.from_id,
			user_id: message.chat_id ? undefined : message.user_id,
			chat_id: message.chat_id,
			chat_title: message.chat_id ? message.title : undefined,
			full_name: `${user.first_name} ${user.last_name}`,
			photo: user.photo_50,
			getMessages: () => this.getDialogMessages(dialog),
			sendMessage: message => this.sendDialogMessage(dialog, message)
		};
		return dialog;
	}
	
	getDialogs() {
		return this.callApiMethod("messages.getDialogs").then(
			({ response: { items } }) => {
				items.forEach(({ message }) => {
					if (message.chat_id) {
						message.from_id = message.user_id;
					}
					else {
						message.from_id = message.out ? this.$rootScope.vk.id : message.user_id;
					}
				});
				const userIds = items.map(({ message }) => message.from_id);
				if (userIds.length === 0) {
					return [];
				}
				return this.callApiMethod("users.get", { user_ids: userIds.join(","), fields: "photo_50" }).then(
					({ response: users }) => {
						return items.map(({ message }) => {
							const user = users.find(user => user.id === message.from_id);
							return this.getDialog(message, user);
						});
					}
				);
			}
		);
	}
}

app.service('vkService', VkService);