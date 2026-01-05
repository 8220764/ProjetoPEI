const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
const path = require('path');

// Configuração
const uri = "mongodb://localhost:27017";
const dbName = "HealthTimeDB";
const filesPath = path.join(__dirname, '../../dados/');

// Configuração de cores
const triageColorMap = {
    'Blue': 'nao urgente',
    'Green': 'pouco urgente',
    'Yellow': 'urgente',
    'Red': 'muito urgente'
};

async function importEmergencies() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Ligado ao MongoDB");

        const db = client.db(dbName);
        const collection = db.collection('emergency_records');
        const emergencyData = [];

        // 1. Carregar Mapa de Hospitais
        console.log("A carregar lista de hospitais para memória...");
        const hospitalMap = new Map();
        const hospitalsFile = path.join(filesPath, 'Hospitais.csv');

        if (fs.existsSync(hospitalsFile)) {
            await new Promise((resolve, reject) => {
                fs.createReadStream(hospitalsFile)
                    .pipe(csv({ separator: ',' }))
                    .on('data', (row) => {
                        if (row.HospitalID && row.HospitalName) {
                            hospitalMap.set(row.HospitalID.trim(), row.HospitalName.trim());
                        }
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });
            console.log(`${hospitalMap.size} hospitais carregados.`);
        } else {
            console.warn("AVISO: Ficheiro Hospitais.csv não encontrado. Os nomes vão aparecer apenas como ID.");
        }

        // 2. Processar CSV de Urgências
        const csvFile = path.join(filesPath, 'TemposEsperaEmergencia.csv');
        if (!fs.existsSync(csvFile)) {
            throw new Error(`Ficheiro não encontrado: ${csvFile}`);
        }

        console.log("A processar registos de urgência...");

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvFile)
                .pipe(csv({
                    separator: ',',
                    mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim()
                }))
                .on('data', (row) => {

                    const hospId = row.institutionId;
                    const hospitalName = hospitalMap.get(hospId) || "Hospital " + hospId;

                    if (hospId) {
                        const triageList = [];

                        // Função auxiliar para ler colunas dinâmicas
                        const processColor = (colorKey, timeCol, lengthCol) => {
                            if (row[timeCol] !== undefined || row[lengthCol] !== undefined) {
                                triageList.push({
                                    color_original: colorKey,
                                    color_value: triageColorMap[colorKey] || 'desconhecido',
                                    waiting: parseInt(row[lengthCol]) || 0,
                                    observing: 0, // CSV não tem observing separado
                                    avg_wait_time: parseInt(row[timeCol]) || 0
                                });
                            }
                        };

                        processColor("Red", "Triage.Red.Time", "Triage.Red.Length");
                        processColor("Yellow", "Triage.Yellow.Time", "Triage.Yellow.Length");
                        processColor("Green", "Triage.Green.Time", "Triage.Green.Length");
                        processColor("Blue", "Triage.Blue.Time", "Triage.Blue.Length");

                        const serviceEntry = {
                            service_type_code: row["EmergencyType.Code"] || "0",
                            service_name: row["EmergencyType.Description"] || "Urgência Geral",
                            status: "Aberto",
                            triage_data: triageList
                        };

                        emergencyData.push({
                            hospital_id: parseInt(hospId),
                            hospital_name: hospitalName,
                            submission_date: new Date(row.LastUpdate || new Date()),
                            services: [serviceEntry]
                        });
                    }
                })
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });

        if (emergencyData.length > 0) {
            // Urgências são snapshots no tempo, usamos insertMany
            const result = await collection.insertMany(emergencyData);
            console.log(`Sucesso! ${result.insertedCount} registos de urgência importados.`);
        } else {
            console.log("AVISO: Nada inserido. O CSV de urgências parece estar vazio ou com colunas erradas.");
        }

    } catch (err) {
        console.error("Erro:", err.message);
    } finally {
        await client.close();
    }
}

importEmergencies();