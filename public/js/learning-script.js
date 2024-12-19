document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id') || '1';
    const guildId = urlParams.get('guildId') || 'defaultGuildId'; // guildIdが渡されていない場合のデフォルト値
    const channelId = urlParams.get('channelId') || 'defaultChannelId'; // channelIdが渡されていない場合のデフォルト値
    const requiredTime = 30 * 1000; // 30秒（本番環境では適切な時間に調整してください）
    let startTime = new Date().getTime();
    let hasScrolledToBottom = false;
    let alerted = 0;

    // 現在のHTMLファイル名から学習番号を抽出
    const currentPath = window.location.pathname;
    const learningNumber = currentPath.split('/').pop().split('.')[0];

    // 戻るボタンのhrefを動的に設定
    const backButton = document.getElementById('backButton');
    if (backButton) {
        backButton.href = `../index.html?id=${userId}&guildId=${guildId}&channelId=${channelId}`;
    }

    function isScrolledToBottom() {
        return (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 10;
    }

    window.addEventListener('scroll', () => {
        if (isScrolledToBottom()) {
            hasScrolledToBottom = true;
            checkCompletion();
            markCompletedSections();
        }
    });

    function markCompletedSections() {
        document.querySelectorAll('.content').forEach(section => {
            section.classList.add('completed');
        });
    }

    function checkCompletion() {
        const currentTime = new Date().getTime();
        const elapsedTime = currentTime - startTime;

        if (elapsedTime >= requiredTime && hasScrolledToBottom && alerted == 0) {
            const completionDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
            updateLearningProgress(completionDate);
        }
    }

    async function updateLearningProgress(completionDate) {
        try {
            alerted = 1;
            console.log('Sending update request:', { userId, learningNumber, completionDate });
            const response = await fetch(`/elearning/api/user/${userId}/update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    [`learning${learningNumber}`]: completionDate,
                    learningNumber: learningNumber
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Failed to update learning progress: ${errorData.error}`);
            }

            const result = await response.json();
            console.log('Update response:', result);

            alert('学習が完了しました！テストページに進むことができます。');
        } catch (error) {
            alerted = 1;
            console.error('Error updating learning progress:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
    }

    // 定期的にコンプリーション状態をチェック
    setInterval(checkCompletion, 1000);
});
