import fetch from 'node-fetch';

async function testImage() {
    console.log('Sending image generation request...');
    try {
        const response = await fetch('http://localhost:3264/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer dummy'
            },
            body: JSON.stringify({
                prompt: "Киберпанк город на Марсе с неоновой подсветкой, высокое разрешение",
                n: 1,
                size: "1024x1024"
            })
        });
        
        const data = await response.json();
        console.log('\nResponse received:');
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error:', error);
    }
}

testImage();
