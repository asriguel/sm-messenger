class MailruService extends BaseService {
	constructor($rootScope, $window, $uibModal, $http, $cookies, toaster, $timeout) {
        super('Mail.ru');
        this.$window = $window;
        this.$uibModal = $uibModal;
        this.$http = $http;
        this.$rootScope = $rootScope;
        this.$cookies = $cookies;
        this.toaster = toaster;
        this.$timeout = $timeout;
		
		this.clientId = 754302;
		
		this.apiURL = "http://appsmail.ru/platform/api";
		this.privateKey = "7c97f09acae3d5dede5542ffecec1f77";
		
		this.authURL = "https://connect.mail.ru/oauth/authorize";
		this.authConfig = {
			redirect_uri: "http://connect.mail.ru/oauth/success.html",
			response_type: "token",
			scope: "photos messages"
		};
		
		this.pollTimeout = 5000;
		
		this.threadTimestamps = {};
		
		this.restoreSession();
    }
	
	restoreSession() {
		const session_key = this.$cookies.get("mailru_token"), uid = this.$cookies.get("mailru_uid");
		if (session_key && uid) {
			super.log(`session key & uid restored from cookies: session_key=${session_key}, uid=${uid}`);
            this.connect(session_key, uid);
        }
		else {
			super.log(`No previous session restored`);
		}
	}
	
	makeSig(params) {
		const requestString = super.buildRequestString(params, { sort: true, joiner: "" });
		const sigString = `${this.uid}${requestString}${this.privateKey}`;
		return md5(sigString);
	}
	
	callApiMethod(methodName, restParams) {
		restParams = restParams || {};
		const params = Object.assign({}, restParams, {
			app_id: this.clientId,
			method: methodName,
			session_key: this.token
		});
		params.sig = this.makeSig(params);
		const url = super.buildRequestURL(this.apiURL, params);
		super.log(`Calling API method ${methodName}: ${url}`);
		return this.$http.get(url).then(
			({ data }) => {
				if (data.error) {
					throw {
						service: this.name,
						message: `API method ${methodName} failed due to: ${data.error.error_msg}`,
						showPopup: true
					};
				}
				return data;
			}
		);
	}
	
	initPoller() {
		setInterval(() => {
			this.callApiMethod("messages.getThreadsList", { uid: this.uid }).then(
				data => {
					const dirtyThreads = data.filter(({ time, user: { uid } }) => {
						return this.threadTimestamps[uid] && this.threadTimestamps[uid] == time;
					});
					const { currentDialog } = this.$rootScope;
					const isCurrentThreadDirty =
							currentDialog
							&& currentDialog.service === "mailru"
							&& dirtyThreads.find(({ user: { uid } }) => currentDialog.user_id == uid);
					data.forEach(({ time, user: { uid } }) => {
						this.threadTimestamps[uid] = time;
					});
					if (dirtyThreads.length > 0) {
						this.$rootScope.$emit("reloadDialogList");
					}
					if (isCurrentThreadDirty) {
						this.$rootScope.$emit("reloadCurrentDialog");
					}
				}
			);
		}, this.pollTimeout);
	}
	
	connect(token, uid) {
		this.token = token;
		this.uid = uid;
        this.connected = true;
		return this.callApiMethod("users.getInfo").then(
			([ user ]) => {
				this.$rootScope.mailru = {
					id: user.uid,
					full_name: `${user.first_name} ${user.last_name}`,
					photo: user.pic
				};
				super.log(`Connect successful: ${JSON.stringify(this.$rootScope.mailru)}`);
				this.$rootScope.$emit("reloadDialogList");
				this.initPoller();
			}
		).catch(err => {
			this.$cookies.remove("mailru_token");
			this.$cookies.remove("mailru_uid");
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
            templateUrl: 'assets/html/mailruAuthModal.html',
            controller: function ($scope, $uibModalInstance) {
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => $uibModalInstance.close({ token: $scope.token, uid: $scope.uid });
            }
        });
        authModal.result
            .then(({ token, uid }) => {
                this.$cookies.put('mailru_token', token);
				this.$cookies.put(`mailru_uid`, uid);
				super.log(`Authorization successful: token=${token}, uid=${uid}`);
                return this.connect(token, uid);
            });
	}
	
	getMessage({ message, time, type }, { full_name, photo }) {
		const isMy = type === 0;
		return {
			text: message.map(({ content }) => content).join(""),
			date: new Date(time * 1000),
			full_name: isMy ? this.$rootScope.mailru.full_name : full_name,
			photo: isMy ? this.$rootScope.mailru.photo : photo
		};
	}
	
	getDialogMessages(dialog) {
		return this.callApiMethod("messages.getThread", { uid: dialog.user_id }).then(
			data => data.map(message => this.getMessage(message, dialog)).reverse()
		);
	}
	
	sendDialogMessage({ user_id }, message) {
		return this.callApiMethod("messages.post", { uid: user_id, message });
	}
	
	getDialog(thread, lastMessage) {
		const dialog = {
			service: "mailru",
			text: lastMessage.message.map(part => String(part.content)).join(""),
			unread: Boolean(thread.unread),
			date: new Date(thread.time * 1000),
			user_id: thread.user.uid,
			full_name: `${thread.user.first_name} ${thread.user.last_name}`,
			photo: thread.user.pic,
			type: 1,
			getMessages: () => this.getDialogMessages(dialog),
			sendMessage: message => this.sendDialogMessage(dialog, message)
		};
		return dialog;
	}
	
	getDialogs() {
		return this.callApiMethod("messages.getThreadsList").then(
			data => {
				return Promise.all(data.map(({ user: { uid } }) => {
					return this.callApiMethod("messages.getThread", { uid, limit: 1 }).then(
						([ message ]) => message
					);
				})).then(messages => {
					return data.map((thread, i) => this.getDialog(thread, messages[i]));
				});
			}
		);
	}
}

app.service('mailruService', MailruService);