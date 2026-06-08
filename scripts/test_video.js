import fetch from 'node-fetch';

async function testVideo() {
    console.log('Sending video generation request (this will take a while)...');
    try {
        const response = await fetch('http://localhost:3264/v1/videos/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer dummy'
            },
            body: JSON.stringify({
                prompt: "Камера медленно пролетает над заснеженным лесом на закате, кинематографично"
            })
        });
        
        const data = await response.json();
        console.log('\nResponse received:');
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error:', error);
    }
}

testVideo();
