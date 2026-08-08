/* Per-tab participant identity: two tabs/browsers on one PC are independent participants. */
(()=>{const key='dubroom:participant-id';let id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID().slice(0,8);sessionStorage.setItem(key,id);}localStorage.setItem(key,id);})();
