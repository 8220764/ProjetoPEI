const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
const path = require('path');

// Configuração
const uri = "mongodb://localhost:27017";
const dbName = "HealthTimeDB";
const filesPath = path.join(__dirname, '../../dados/');

async function importHospitals() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Ligado ao MongoDB (Hospitais)");

        const db = client.db(dbName);
        const collection = db.collection('hospitals');

        const bulkOps = [];
        let rowCount = 0;

        const csvFile = path.join(filesPath, 'Hospitais.csv');
        if (!fs.existsSync(csvFile)) {
            throw new Error(`Ficheiro não encontrado: ${csvFile}`);
        }

        console.log("A ler Hospitais.csv...");

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvFile)
                .pipe(csv({
                    separator: ',',
                    // Limpa caracteres estranhos do início do ficheiro (BOM)
                    mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim()
                }))
                .on('data', (row) => {
                    rowCount++;

                    if (rowCount === 1) console.log("Colunas do CSV:", Object.keys(row));

                    if (row.HospitalID) {
                        const id = parseInt(row.HospitalID);

                        // Tratar coordenadas com vírgula (Ex: "38,70" -> 38.70)
                        let lat = 0, lon = 0;
                        if (row.Latitude) lat = parseFloat(row.Latitude.replace(',', '.'));
                        if (row.Longitude) lon = parseFloat(row.Longitude.replace(',', '.'));

                        if (!isNaN(id)) {
                            const hospitalDoc = {
                                _id: id, // Usamos o ID do hospital como chave primária
                                name: row.HospitalName,
                                region: row.NUTSIIDescription || row.Region, // Fallback se o nome variar
                                address: {
                                    street: row.Address,
                                    city: row.District || row.Concelho,
                                },
                                contacts: {
                                    phone: row.PhoneNum || row.Phone,
                                    email: row.Email
                                },
                                location: {
                                    type: "Point",
                                    coordinates: [lon, lat] // MongoDB usa [Longitude, Latitude]
                                },
                                last_updated: new Date()
                            };

                            bulkOps.push({
                                updateOne: {
                                    filter: { _id: id },
                                    update: { $set: hospitalDoc },
                                    upsert: true
                                }
                            });
                        }
                    }
                })
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });

        if (bulkOps.length > 0) {
            const result = await collection.bulkWrite(bulkOps);
            console.log(`Processo concluído!`);
            console.log(`   - Encontrados: ${rowCount}`);
            console.log(`   - Inseridos/Atualizados: ${result.upsertedCount + result.modifiedCount}`);
        } else {
            console.log("AVISO: Nenhum dado válido encontrado.");
        }

    } catch (err) {
        console.error("Erro:", err.message);
    } finally {
        await client.close();
    }
}

importHospitals();