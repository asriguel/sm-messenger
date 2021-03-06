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
		
		this.clientId = 6033392;
		this.icon = 'https://cdn.iconscout.com/public/images/icon/free/png-256/vk-social-media-30e7c557bc2ab7f2-256x256.png';
		
		this.apiURL = "https://api.vk.com/method";
		this.apiVersion = "5.65";
		this.apiErrorCodes = {
			TOO_MANY_REQUESTS: 6
		};
		
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
			OUTBOX: 1 << 1
		};
		this.chatOffset = 2000000000;
		
		this.pollTimeout = 1000;
		
		//this.queueCooldown = 400;

        if ($cookies.get("vk_token")) {
            this.connect($cookies.get("vk_token"));
        }
    }

	queue(apiRequestCallback) {
		this.scheduledTimestamps = this.scheduledTimestamps || [ 0, 0, 0 ];
		const firstTimestamp = this.scheduledTimestamps[0];
		const ts = Date.now();
		let scheduledRequestTimestamp;
		if (firstTimestamp === 0) {
			scheduledRequestTimestamp = ts + 1;
		}
		else {
			let i = this.scheduledTimestamps.findIndex(ts => ts === 0);
			if (i < 0) {
				i = this.scheduledTimestamps.length;
			}
			const lastTimestamp = this.scheduledTimestamps[i];
			const threshold = Math.max(firstTimestamp + 1000, lastTimestamp);
			if (ts < threshold) {
				scheduledRequestTimestamp = threshold + 1;
			}
			else {
				scheduledRequestTimestamp = ts + 1;
			}
		}
		const i = this.scheduledTimestamps.findIndex(ts => ts === 0);
		if (i >= 0) {
			this.scheduledTimestamps[i] = scheduledRequestTimestamp;
		}
		else {
			this.scheduledTimestamps.copyWithin(0, 1);
			this.scheduledTimestamps[this.scheduledTimestamps.length - 1] = scheduledRequestTimestamp;
		}
		return new Promise(resolve => {
			setTimeout(() => {
				apiRequestCallback().then(resolve);
			}, scheduledRequestTimestamp - ts);
		});
	}
	
	callApiMethod(methodName, params) {
		const url = super.buildRequestURL(
			`${this.apiURL}/${methodName}`,
			Object.assign({}, params, { access_token: this.token, v: this.apiVersion })
		);
		return this.queue(() => {
			return this.$http.jsonp(url).then(
				({ data }) => {
					if (data.error) {
						throw {
							service: this.name,
							message: `API method ${methodName} failed due to: ${data.error.error_msg}`,
							showPopup: data.error.error_code !== this.apiErrorCodes.TOO_MANY_REQUESTS
						};
					}
					return data;
				}
			);
		});
	}
	
	initPoller() {
		return this.callApiMethod("messages.getLongPollServer").then(({ response: { ts, key, server } }) => {
			const poller = () => {
				const url = super.buildRequestURL(
					`https://${server}`,
					Object.assign({}, this.pollConfig, { ts, key })
				);
				return this.queue(() => {
					return this.$http.get(url).then(
						({ data }) => {
							if (data.failed) {
								throw {
									service: this.name,
									message: `polling failed due to: ${data.failed}`
								};
							}
							return this.processUpdates(data.updates).then(() => {
								ts = data.ts;
								setTimeout(() => poller(), this.pollTimeout);
							});
						}
					);
				});
			};
			poller();
		});
	}
	
	processUpdate([ eventCode, ...data ]) {
		if (eventCode == this.pollEventCodes.NEW_MESSAGE) {
			super.log(`New message: ${JSON.stringify([ eventCode, ...data ])}`);
			const [ messageId, flags, peerId, timestamp, text, extra ] = data;
			const isChat = peerId > this.chatOffset;
			const { currentDialog } = this.$rootScope;
			let currentDialogInvalidated = false;
			if (currentDialog) {
				const { service, type } = currentDialog;
				if (service === "vk") {
					const isCurrentChat = type === 2;
					if (isChat === isCurrentChat) {
						if (
							(isChat && currentDialog.chat_id + this.chatOffset == peerId) ||
							(!isChat && currentDialog.user_id == peerId)
						) {
							currentDialogInvalidated = true;
						}
					}
				}
			}
			const updateData = { currentDialogInvalidated };
			if (!(flags & this.messageFlags.OUTBOX) && (flags & this.messageFlags.UNREAD)) {
				const fromId = isChat ? extra.from : peerId;
				Object.assign(updateData, { fromId, text });
			}
			return updateData;
		}
	}
	
	processUpdates(updates) {
		const updateDataArray = updates.map(update => this.processUpdate(update)).filter(data => data != null);
		if (updateDataArray.length === 0) {
			return Promise.resolve();
		}
		super.log(`Updates: ${JSON.stringify(updateDataArray)}`);
		const userIds = updateDataArray.filter(data => data.fromId).map(({ fromId }) => fromId);
		return this.callApiMethod("users.get", { user_ids: userIds.join(",") }).then(
			({ response: users }) => {
				updateDataArray.forEach(data => {
					if (data.fromId) {
						const { fromId, text } = data;
						const { first_name, last_name } = users.find(user => user.id == fromId);
						const fullName = `${first_name} ${last_name}`;
						this.toaster.pop("success", fullName, text);
					}
				});
				this.$rootScope.$emit("reloadDialogList");
				if (updateDataArray.some(({ currentDialogInvalidated }) => currentDialogInvalidated)) {
					this.$rootScope.$emit("reloadCurrentDialog");
				}
			}
		);
	}

    connect(token) {
        this.token = token;
        this.connected = true;
		return this.callApiMethod("users.get", { fields: "photo_50" }).then(({ response: [ user ] }) => {
			this.$rootScope.vk = {
				id: user.id
			};
			super.log(`Connect successful: ${JSON.stringify(this.$rootScope.vk)}`);
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
        const authModal = this.$uibModal.open({
            templateUrl: 'assets/html/vkAuthModal.html',
            controller: function ($scope, $uibModalInstance) {
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => $uibModalInstance.close($scope.token);
            }
        });
        return authModal.result.then(token => {
			super.log(`Authorization successful: token=${token}`);
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
			photo: user.photo_50,
			my: message.from_id == this.$rootScope.vk.id,
			images: (message.attachments || []).filter(({ type }) => type === "photo").map(({ photo: { photo_604 } }) => photo_604)
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
							const user = users.find(user => user.id == item.from_id);
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
	
	getDialog(message, user, peerData) {
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
			my: message.from_id == this.$rootScope.vk.id,
			peer: {
				full_name: peerData.isChat ? message.title : peerData.full_name,
				photo: peerData.isChat ? message.photo_50 : peerData.photo_50
			},
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
				userIds.push(...items.filter(({ message }) => !message.chat_id).map(({ message }) => message.user_id));
				if (userIds.length === 0) {
					return [];
				}
				return this.callApiMethod("users.get", { user_ids: userIds.join(","), fields: "photo_50" }).then(
					({ response: users }) => {
						return items.map(({ message }) => {
							const user = users.find(user => user.id == message.from_id);
							const peerData = { isChat: Boolean(message.chat_id) };
							if (!peerData.isChat) {
								const peer = users.find(user => user.id == message.user_id);
								peerData.full_name = `${peer.first_name} ${peer.last_name}`;
								peerData.photo_50 = peer.photo_50;
							}
							return this.getDialog(message, user, peerData);
						});
					}
				);
			}
		);
	}
}

app.service('vkService', VkService);