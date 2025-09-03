const clearChatBtn = document.getElementById('clearChatBtn');
clearChatBtn.addEventListener('click', () => {
    if(confirm('Are you sure you want to clear all messages?')) {
        const messagesRef = firebase.database().ref('messages');
        messagesRef.remove()
            .then(() => {
                document.getElementById('chatContainer').innerHTML = '';
                alert('All messages cleared!');
            })
            .catch(err => console.error('Error clearing messages:', err));
    }
});