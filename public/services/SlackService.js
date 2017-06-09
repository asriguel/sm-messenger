class SlackService extends BaseService {
	constructor($rootScope, $window, $uibModal, $http, $cookies, toaster, $timeout) {
        super('Slack');
        this.$window = $window;
        this.$uibModal = $uibModal;
        this.$http = $http;
        this.$rootScope = $rootScope;
        this.$cookies = $cookies;
        this.toaster = toaster;
        this.$timeout = $timeout;
		
		this.icon = "https://s-media-cache-ak0.pinimg.com/originals/94/2a/74/942a74f009074802986cc1ed0feca078.jpg";
		
		this.clientId = "194468629137.194967149827";
		this.secret = "ef0e3e2d4e4aa99f11b1e489f0961e90";
		
		this.authURL = "https://slack.com/oauth/authorize";
		this.authConfig = {
			redirect_uri: "http://sm-messenger.herokuapp.com/blank.html",
			scope: "im:history im:read im:write users:read users:read.email chat:write:user"
		};
		
		this.apiURL = "https://slack.com/api";
		
		this.pollTimeout = 5000;
		
		this.timestamps = {};
		
		this.restoreSession();
	}
	
	restoreSession() {
		const token = this.$cookies.get("slack_token");
		const uid = this.$cookies.get("slack_uid");
		const tid = this.$cookies.get("slack_tid");
		if (token && uid && tid) {
			super.log(`Restoring session`);
			this.connect(token, uid, tid);
		}
		else {
			super.log(`No session restored`);
		}
	}
	
	callApiMethod(methodName, params, init) {
		params = params || {};
		init = init == null ? false : Boolean(init);
		const url = super.buildRequestURL(
			`${this.apiURL}/${methodName}`,
			Object.assign({}, params, init ? {} : { token: this.token })
		);
		return this.$http.get(url).then(({ data }) => {
			if (!data.ok) {
				throw {
					service: this.name,
					message: `API method ${methodName} failed due to: ${data.error}`,
					showPopup: true
				};
			}
			console.log(`Received data: ${JSON.stringify(data)}`);
			return data;
		});
	}
	
	initPoller() {
		setInterval(() => {
			this.callApiMethod("im.list").then(
				({ ims }) => {
					const channelIds = ims.map(({ id }) => id);
					return Promise.all(
						channelIds.map(id => {
							return this.callApiMethod("im.history", { channel: id, count: 1 }).then(
								({ messages: [ message ] }) => {
									return message ? { id, message } : {};
								}
							);
						}).filter(({ message }) => message)
					).then(
						latestMessages => {
							const latestTimestamps = latestMessages.map(latestMessage => {
								const { message } = latestMessage;
								const { ts } = message;
								return ts;
							});
							const dirtyIms = ims.filter(({ id }) => {
								if (!this.timestamps[id]) {
									return true;
								}
								const { message: { ts } } = latestMessages.find(({ id: messageId }) => messageId == id);
								return this.timestamps[id] != ts;
							});
							const { currentDialog } = this.$rootScope;
							const isCurrentThreadDirty =
									currentDialog
									&& currentDialog.service === "slack"
									&& dirtyIms.find(({ id }) => currentDialog.id == id);
							latestMessages.forEach(({ id, message: { ts } }) => {
								this.timestamps[id] = ts;
							});
							if (dirtyIms.length > 0) {
								this.$rootScope.$emit("reloadDialogList");
							}
							if (isCurrentThreadDirty) {
								this.$rootScope.$emit("reloadCurrentDialog");
							}
						}
					);
				}
			);
		}, this.pollTimeout);
	}
	
	connect(token, uid, tid) {
		this.token = token;
		this.connected = true;
		return this.callApiMethod("users.info", { user: uid }).then(
			({ user: { profile: { real_name, image_48 } } }) => {
				this.$rootScope.slack = { uid, tid, full_name: real_name, photo: image_48 };
				super.log(`Connect successful: ${JSON.stringify(this.$rootScope.slack)}`);
				this.$rootScope.$emit("reloadDialogList");
				this.initPoller();
			}
		).catch(err => {
			this.$cookies.remove("slack_token");
			this.$cookies.remove("slack_uid");
			this.$cookies.remove("slack_tid");
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
            templateUrl: 'assets/html/slackAuthModal.html',
            controller: function ($scope, $uibModalInstance) {
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => $uibModalInstance.close($scope.code);
            }
        });
        return authModal.result.then(code => {
			super.log(`Successfully acquired code: ${code}`);
			return this.callApiMethod("oauth.access", {
				client_id: this.clientId,
				client_secret: this.secret,
				code,
				redirect_uri: this.authConfig.redirect_uri 
			}, true).then(({ access_token, user_id, team_id }) => {
				this.$cookies.put("slack_token", access_token);
				this.$cookies.put("slack_uid", user_id);
				this.$cookies.put("slack_tid", team_id);
				super.log(`Authorization successful: token=${access_token}, user_id=${user_id}, team_id=${team_id}`);
				return this.connect(access_token, user_id, team_id);
			});
		});
    }
	
	getDialogMessages(dialog) {
		return this.callApiMethod("im.history", { channel: dialog.id }).then(
			({ messages }) => {
				return messages.map(({ user, text, ts, subtype, file }) => {
					const msg = {
						text,
						date: new Date(Number(ts.substring(0, ts.indexOf("."))) * 1000),
						full_name: user == this.$rootScope.slack.uid ? this.$rootScope.slack.full_name : dialog.peer.full_name,
						photo: user == this.$rootScope.slack.uid ? this.$rootScope.slack.photo : dialog.peer.photo,
						my: user == this.$rootScope.slack.uid,
						images: subtype === "file_share" && file && file.mimetype && file.mimetype.startsWith("image")
						? [ file.url_private ] : []
					};
					console.log(`Message: ${JSON.stringify(msg)}`);
					return msg;
				}).reverse();
			}
		);
	}
	
	sendDialogMessage(dialog, message) {
		return this.callApiMethod("chat.postMessage", { channel: dialog.id, text: message, as_user: true }).then(
			data => {
				console.log(`Message sent: ${JSON.stringify(data)}`);
				return data;
			}
		);
	}
	
	getDialogs() {
		return this.callApiMethod("im.list").then(
			({ ims }) => {
				return Promise.all(ims.map(({ id, user }) => {
					return this.callApiMethod("im.history", { channel: id, count: 1 }).then(
						({ messages: [ message ] }) => {
							if (!message) {
								return Promise.resolve(null);
							}
							const { user: userId, text, ts } = message;
							return this.callApiMethod("users.info", { user: userId }).then(
								({ user: { profile: { real_name, image_48 } } }) => {
									return this.callApiMethod("users.info", { user }).then(
										({ user: { profile: { real_name: peerName, image_48: peerPhoto } } }) => {
											const dialog = {
												service: "slack",
												id,
												text,
												unread: false,
												date: new Date(Number(ts.substring(0, ts.indexOf("."))) * 1000),
												user_id: user,
												full_name: real_name,
												photo: image_48,
												my: userId == this.$rootScope.slack.uid,
												type: 1,
												peer: {
													full_name: peerName,
													photo: peerPhoto
												},
												getMessages: () => this.getDialogMessages(dialog),
												sendMessage: message => this.sendDialogMessage(dialog, message)
											};
											console.log(`Dialog: ${JSON.stringify(dialog)}`);
											return dialog;
										}
									);
								}
							);
						}
					);
				})).then(dialogs => dialogs.filter(dialog => dialog != null));
			}
		);
	}
}

app.service('slackService', SlackService);