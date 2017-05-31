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

        if ($cookies.get('vk_token')) {
            this.connect($cookies.get('vk_token'));
        }
    }

    setClientId(clientId) {
        this.clientId = clientId;
    }

    connect(token) {
        this.token = token;
        this.connected = true;
        this.$rootScope.$emit('updateDialogs');

        this.$http.jsonp(`https://api.vk.com/method/users.get?access_token=${this.token}&fields=photo_50`)
            .then(response => {
                if (response.data.error) {
                    this.$cookies.remove('vk_token');
                    throw {service: 'VKontakte', message: response.data.error.error_msg};
                }

                let user = response.data.response[0];
                this.$rootScope.vk = {};
                this.$rootScope.vk.id = user.uid;
                this.$rootScope.vk.full_name = user.first_name + ' ' + user.last_name;
                this.$rootScope.vk.photo = user.photo_50;
            })
            .catch(err => this.toaster.pop('error', err.service, err.message));

        this.$http.jsonp(`https://api.vk.com/method/messages.getLongPollServer?access_token=${this.token}`)
            .then(response => {
                let ts = response.data.response.ts;
                let poller = () => {
                    this.$http.get(`https://${response.data.response.server}?act=a_check&key=${response.data.response.key}&ts=${ts}&wait=25&mode=2&version=1`)
                        .then(response => {
                            response.data.updates.forEach(update => {
                                if (update[0] == 4) {
                                    if (update[2] != 35 && update[3] != this.$rootScope.vk.id) {
                                        this.$http.jsonp(`https://api.vk.com/method/users.get?access_token=${this.token}&user_ids=${update[3]}`)
                                            .then(response => this.toaster.pop('success', response.data.response[0].first_name + ' ' + response.data.response[0].last_name, update[6]));

                                        if ((this.$rootScope.currentDialog.service = 'vk' && this.$rootScope.currentDialog.type == '1' && this.$rootScope.currentDialog.user_id == update[3])
                                            || (this.$rootScope.currentDialog.service = 'vk' && this.$rootScope.currentDialog.type == '2' && this.$rootScope.currentDialog.chat_id == update[3])) {
                                            this.$rootScope.$emit('rerenderMessages');
                                            this.$rootScope.$emit('scrollBottom');
                                        }
                                    }
                                    this.$rootScope.$emit('updateDialogs');
                                }
                            });
                            ts = response.data.ts;
                            this.$timeout(poller, 1000);
                        })
                        .catch(() => {
                        });
                };
                poller();
            })
            .catch(err => this.toaster.pop('error', err.service, err.message));
    }

    auth() {
        this.$window.open(`https://oauth.vk.com/authorize?client_id=${this.clientId}&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=messages&response_type=token`, '_blank');
        let authModal = this.$uibModal.open({
            templateUrl: 'assets/html/vkAuthModal.html',
            controller: function ($scope, $uibModalInstance) {
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => $uibModalInstance.close($scope.token);
            }
        });
        authModal.result
            .then((token) => {
                this.$cookies.put('vk_token', token);
                this.connect(token);
            });
    }

    getDialogs() {
        return this.$http.jsonp(`https://api.vk.com/method/messages.getDialogs?access_token=${this.token}`)
            .then(response => {
                if (response.data.error) {
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

                return Promise.all([this.$http.jsonp(`https://api.vk.com/method/users.get?access_token=${this.token}&user_ids=${user_ids}&fields=photo_50`), dialogs]);
            })
            .then(([usersData, dialogs]) => {
                dialogs.forEach(dialog => {
                    let user = usersData.data.response.find(user => user.uid == dialog.user_id);
                    dialog.full_name = user.first_name + ' ' + user.last_name;
                    dialog.photo = user.photo_50;
                    dialog.getMessages = (offset) => {
                        let urlId = (dialog.type == '1') ? `user_id=${dialog.user_id}` : `chat_id=${dialog.chat_id}`;
                        return this.$http.jsonp(`https://api.vk.com/method/messages.getHistory?access_token=${this.token}&${urlId}`)
                            .then(response => {
                                if (response.data.error) {
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

                                return Promise.all([(user_ids.length) ? this.$http.jsonp(`https://api.vk.com/method/users.get?access_token=${this.token}&user_ids=${user_ids}&fields=photo_50`) : false, messages]);
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
                        let urlId = (dialog.type == '1') ? `user_id=${dialog.user_id}` : `chat_id=${dialog.chat_id}`;
                        this.$http.jsonp(`https://api.vk.com/method/messages.send?access_token=${this.token}&message=${message}&${urlId}`);
                    };
                });

                return dialogs;
            });
    }
}

app.service('vkService', VkService);