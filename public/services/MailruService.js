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
		
		this.apiURL = "http://appsmail.ru/platform/api";
		this.privateKey = "	7c97f09acae3d5dede5542ffecec1f77";
		this.pollTimeout = 5000;

        if ($cookies.get('mailru_token')) {
            this.connect($cookies.get('mailru_token'));
        }
    }
	
	setClientId(clientId) {
		this.clientId = clientId;
	}
	
	makeSig(params) {
		const paramString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join("");
		const sigString = `${this.uid}${paramString}${this.privateKey}`;
		return md5(sigString);
	}
	
	callApiMethod(methodName, restParams) {
		restParams = restParams || {};
		const params = {
			app_id: this.clientId,
			method: methodName,
			session_key: this.token
		};
		Object.keys(restParams).forEach(key => params[key] = restParams[key]);
		const sig = this.makeSig(params);
		params.sig = sig;
		const requestParams = Object.keys(params).map(key => `${key}=${params[key]}`).join("&");
		const request = `${this.apiURL}?${requestParams}`;
		console.log(`Calling API: ${request}`);
		return this.$http.jsonp(request);
	}
	
	initUser() {
		this.callApiMethod("users.getInfo").then(response => {
			console.log("initUser=" + JSON.stringify(response));
			if (response.error) {
				this.$cookies.remove('mailru_token');
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.error.error_msg };
			}
			const user = response[0];
			this.$rootScope.mailru = {
				id: user.uid,
				full_name: `${user.first_name} ${user.last_name}`,
				photo: user.has_pic ? user.pic : ""
			};
		}).catch(err => this.toaster.pop("error", err.service, err.message));
	}
	
	poll() {
		this.callApiMethod("messages.getUnreadCount").then(response => {
			console.log("Poll=" + JSON.stringify(response));
			if (response.count > 0) {
				this.$rootScope.currentDialog.service = "mailru";
				this.$rootScope.$emit("rerenderMessages");
				this.$rootScope.$emit("scrollBottom");
				this.$rootScope.$emit("updateDialogs");
			}
		});
	}
	
	setupPoller() {
		this.$timeout(() => this.poll(), this.pollTimeout);
		console.log("Poller initialized");
	}
	
	connect(token, uid) {
		this.token = token;
		this.uid = uid;
        this.connected = true;
        //this.$rootScope.$emit('updateDialogs');
		
		this.initUser();
		this.setupPoller();
	}
	
	auth() {
		const authURL = "https://connect.mail.ru/oauth/authorize";
		const redirectURI = "http://connect.mail.ru/oauth/success.html";
		const responseType = "token";
		const privileges = [ "photos", "messages" ];
		const scope = privileges.join(" ");
		const params = [
			`client_id=${this.clientId}`,
			`redirect_uri=${redirectURI}`,
			`response_type=${responseType}`,
			`scope=${scope}`
		].join("&");
		const authRequest = `${authURL}?${params}`;
		
		this.$window.open(authRequest, '_blank');
        let authModal = this.$uibModal.open({
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
				console.log(`Authorization successful: token=${token}, uid=${uid}`);
                this.connect(token, uid);
            });
	}
	
	getDialogMessages(thread) {
		this.callApiMethod("messages.getThread", { uid: thread.uid }).then(response => {
			console.log("getDialogMessages=" + JSON.stringify(response));
			if (response.error) {
				this.$cookies.remove("mailru_token");
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.error.error_msg };
			}
			return response.map(message => {
				const isMy = message.type === 1;
				return {
					text: message.filtered_message,
					date: new Date(message.time * 1000),
					photo: isMy ? this.$rootScope.mailru.photo : thread.pic,
					full_name: isMy ? this.$rootScope.mailru.full_name : `${thread.first_name} ${thread.last_name}`
				};
			}).reverse();
		});
	}
	
	sendDialogMessage(message, uid) {
		this.callApiMethod("messages.post", { uid, message });
	}
	
	getDialogs() {
		this.callApiMethod("messages.getThreadsList").then(response => {
			console.log("getDialogs=" + JSON.stringify(response));
			if (response.error) {
				this.$cookies.remove("mailru_token");
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.error.error_msg };
			}
			return dialogs = response.map(thread => {
				return {
					service: "mailru",
					unread: Boolean(thread.unread),
					date: new Date(thread.time * 1000),
					user_id: thread.uid,
					full_name: `${thread.first_name} ${thread.last_name}`,
					photo: thread.pic,
					getMessages: () => this.getDialogMessages(thread),
					sendMessage: message => this.sendDialogMessage(message, thread.uid),
					type: "1" //TODO conversations
				};
			});
		});
	}
}

app.service('mailruService', MailruService);