const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function enviarXML() {
    const form = new FormData();
    form.append('xmlfile', fs.createReadStream('./teste_urgencia.xml'));

    try {
        console.log("A enviar XML para o servidor...");
        
        const response = await axios.post('http://localhost:3000/api/urgencia', form, {
            headers: {
                ...form.getHeaders()
            }
        });

        console.log("Resposta do Servidor:", response.data);
    } catch (error) {
        console.error("Erro no envio:", error.response ? error.response.data : error.message);
    }
}

enviarXML();