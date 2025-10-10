const googleSheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcjtPM-3LNZFamySSe9rbVOjTu1pRSQ0Te5ILx6MmF9ClbBJUZvnfPHYsIg4_CclD_7ba0lv1QMdiZ/pub?output=csv';
const eventDataUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcjtPM-3LNZFamySSe9rbVOjTu1pRSQ0Te5ILx6MmF9ClbBJUZvnfPHYsIg4_CclD_7ba0lv1QMdiZ/pub?output=csv&gid=1404690345';
const guestDataPromise = fetch(googleSheetUrl).then(res => res.text());
const eventDataPromise = fetch(eventDataUrl).then(res => res.text());

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('i');

    const guestCsvText = await guestDataPromise;
    processGuestData(code, guestCsvText);

    setupSectionAnimations();
    setupVerticalScrolling();
});

function setupVerticalScrolling() {
    document.querySelectorAll('.scroll-section').forEach(section => {
        const scrollableContent = section.querySelector('.scrollable-content');
        const upButton = section.querySelector('.scroll-v-button.up');
        const downButton = section.querySelector('.scroll-v-button.down');
        const topFade = section.querySelector('.fade-overlay.top');
        const bottomFade = section.querySelector('.fade-overlay.bottom');

        if (!scrollableContent || !upButton || !downButton || !topFade || !bottomFade) return;

        const checkOverflow = () => {
            const hasOverflow = scrollableContent.scrollHeight > scrollableContent.clientHeight;

            if (hasOverflow) {
                scrollableContent.addEventListener('scroll', handleScroll);
                handleScroll(); 
            } else {
                scrollableContent.removeEventListener('scroll', handleScroll);
                upButton.classList.remove('visible');
                downButton.classList.remove('visible');
                topFade.style.opacity = '0';
                bottomFade.style.opacity = '0';
            }
        };

        const handleScroll = () => {
            const scrollTop = scrollableContent.scrollTop;
            const scrollHeight = scrollableContent.scrollHeight;
            const clientHeight = scrollableContent.clientHeight;

            const isAtTop = scrollTop === 0;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1; 

            upButton.classList.toggle('visible', !isAtTop);
            downButton.classList.toggle('visible', !isAtBottom);
            
            topFade.style.opacity = isAtTop ? '0' : '1';
            bottomFade.style.opacity = isAtBottom ? '0' : '1';
        };

        upButton.addEventListener('click', () => {
            scrollableContent.scrollBy({ top: -scrollableContent.clientHeight * 0.8, behavior: 'smooth' });
        });

        downButton.addEventListener('click', () => {
            scrollableContent.scrollBy({ top: scrollableContent.clientHeight * 0.8, behavior: 'smooth' });
        });

        const resizeObserver = new ResizeObserver(checkOverflow);
        resizeObserver.observe(scrollableContent);
        
        const mutationObserver = new MutationObserver(checkOverflow);
        mutationObserver.observe(scrollableContent, { childList: true, subtree: true });

        checkOverflow();
    });
}

function parseCsvRow(rowString) {
    const result = [];
    let currentField = '';
    let inQuotes = false;
    for (let i = 0; i < rowString.length; i++) {
        const char = rowString[i];
        const nextChar = rowString[i + 1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }
    result.push(currentField.trim());
    return result;
}

function setupNavigation() {
    const container = document.querySelector('.scroll-container'); // Target the new scrolling container
    const sections = Array.from(document.querySelectorAll('.scroll-section'));
    const indicatorContainer = document.querySelector('.indicator-container');
    const leftBtn = document.querySelector('.scroll-button.left');
    const rightBtn = document.querySelector('.scroll-button.right');

    if (!container || sections.length <= 1) {
        if(leftBtn) leftBtn.classList.add('hidden');
        if(rightBtn) rightBtn.classList.add('hidden');
        if(indicatorContainer) indicatorContainer.classList.add('hidden');
        return;
    }
    // If we have more than one section, show the controls
    if(leftBtn) leftBtn.classList.remove('hidden');
    if(rightBtn) rightBtn.classList.remove('hidden');
    if(indicatorContainer) indicatorContainer.classList.remove('hidden');

    const scrollToSection = (index) => {
        const targetSection = sections[index];
        if (targetSection) {
            // Calculate scroll position based on the section's width
            const scrollPosition = index * targetSection.offsetWidth;
            container.scrollTo({ left: scrollPosition, behavior: 'smooth' });
        }
    };

    // Create indicator dots
    indicatorContainer.innerHTML = '';
    sections.forEach((_, index) => {
        const dot = document.createElement('button');
        dot.classList.add('indicator-dot');
        dot.setAttribute('aria-label', `Go to section ${index + 1}`);
        dot.addEventListener('click', () => scrollToSection(index));
        indicatorContainer.appendChild(dot);
    });

    const dots = indicatorContainer.querySelectorAll('.indicator-dot');

    // Observer to update active state
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const intersectingIndex = sections.indexOf(entry.target);
                
                dots.forEach((dot, dotIndex) => {
                    dot.classList.toggle('active', dotIndex === intersectingIndex);
                });

                leftBtn.disabled = intersectingIndex === 0;
                rightBtn.disabled = intersectingIndex === sections.length - 1;
            }
        });
    }, { root: container, threshold: 0.6 });

    sections.forEach(section => observer.observe(section));

    // Button click handlers
    leftBtn.addEventListener('click', () => {
        const currentIndex = Math.round(container.scrollLeft / sections[0].offsetWidth);
        if (currentIndex > 0) scrollToSection(currentIndex - 1);
    });

    rightBtn.addEventListener('click', () => {
        const currentIndex = Math.round(container.scrollLeft / sections[0].offsetWidth);
        if (currentIndex < sections.length - 1) scrollToSection(currentIndex + 1);
    });
}

function handlePlurals(type, count) {
    const elements = document.querySelectorAll(`[data-${type}-singular]`);
    if (!elements || elements.length === 0) return;

    elements.forEach(element => {
        const singularText = element.dataset[`${type}Singular`];
        const pluralText = element.dataset[`${type}Plural`];
        element.textContent = count === 1 ? singularText : pluralText;
    });
}

async function processGuestData(code, csvText) {
    try {
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const headers = parseCsvRow(lines[0]);
        const dataRows = lines.slice(1).map(line => parseCsvRow(line));

        const colIndices = {
            codigo: headers.indexOf('Codigo'),
            nombre: headers.indexOf('Nombre'),
            invitados: headers.indexOf('Invitados'),
            cantidad: headers.indexOf('Cantidad'),
            discurso: headers.indexOf('Discurso'), // Renamed from Conferencia
            recepcion: headers.indexOf('Recepcion'), // Renamed from Fiesta
            video: headers.indexOf('Video'),       // Renamed from Zoom
            civil: headers.indexOf('Civil'),
            eventos: headers.indexOf('Eventos')
        };

        for (const key in colIndices) {
            if (colIndices[key] === -1) throw new Error(`Column "${key}" not found.`);
        }

        let guestRow = null;
        // Only try to find a guest if a code was provided.
        if (code) {
            for (const row of dataRows) {
                const encryptedCode = row[colIndices.codigo];
                if (!encryptedCode) continue;

                const decryptedCode = XXTEA.decryptFromBase64(encryptedCode, code);

                if (decryptedCode === code) {
                    const decryptedNombre = XXTEA.decryptFromBase64(row[colIndices.nombre], code);
                    const decryptedInvitados = XXTEA.decryptFromBase64(row[colIndices.invitados], code);

                    guestRow = [...row];
                    guestRow[colIndices.codigo] = decryptedCode;
                    guestRow[colIndices.nombre] = decryptedNombre;
                    guestRow[colIndices.invitados] = decryptedInvitados;
                    break;
                }
            }
        }

        if (guestRow) {
            document.getElementById('group-name').textContent = `${guestRow[colIndices.nombre]}`;
            const decryptedInvitados = guestRow[colIndices.invitados] || '';
            const guestList = decryptedInvitados.split(',').map(name => name.trim()).filter(name => name);

            let guestListString = "";
            if (guestList.length > 0) {
                if (guestList.length === 1) {
                    guestListString = guestList[0];
                } else if (guestList.length === 2) {
                    guestListString = guestList.join(" y ");
                } else {
                    guestListString = guestList.slice(0, -1).join(", ") + " y " + guestList.slice(-1);
                }
            }
            document.getElementById('guest-names').textContent = guestListString;

            const guestCount = parseInt(guestRow[colIndices.cantidad], 10) || 0;
            if (guestCount > 0) {
                document.getElementById('guest-count').textContent = guestCount;
            }
            handlePlurals('guest', guestCount);

            const isInvitedToReception = guestRow[colIndices.recepcion]?.toLowerCase() === 'si';

            const sectionsToShow = {
                portada: true,
                invitacion: true,
                civil: guestRow[colIndices.civil]?.toLowerCase() === 'si',
                discurso: guestRow[colIndices.discurso]?.toLowerCase() === 'si',
                fiesta: isInvitedToReception,
                zoom: guestRow[colIndices.video]?.toLowerCase() === 'si',
                rsvp: isInvitedToReception,
                contratapa: true
            };

            // Build the dynamic event list for the invitation section
            const eventList = [];
            if (sectionsToShow.civil) eventList.push("ceremonia civil");
            if (sectionsToShow.discurso) eventList.push("discurso de bodas");
            if (sectionsToShow.fiesta) eventList.push("recepción de bodas");

            let eventListString = "";
            if (eventList.length > 0) {
                if (eventList.length === 1) {
                    eventListString = eventList[0];
                } else if (eventList.length === 2) {
                    eventListString = eventList.join(" y ");
                } else {
                    eventListString = eventList.slice(0, -1).join(", ") + " y " + eventList.slice(-1);
                }
            }
            const eventListElement = document.getElementById('event-list');
            if(eventListElement) {
                eventListElement.textContent = eventListString;
                handlePlurals('event', eventList.length);
            }

            // Decrypt the event key and fetch event details
            const encryptedEventKey = guestRow[colIndices.eventos];
            if (encryptedEventKey) {
                const eventKey = XXTEA.decryptFromBase64(encryptedEventKey, code);
                if (eventKey) {
                    const eventCsvText = await eventDataPromise;
                    await processEventDetails(eventKey, sectionsToShow, eventCsvText);
                }
            }

            document.querySelectorAll('[data-section]').forEach(item => {
                if (sectionsToShow[item.dataset.section]) {
                    item.classList.remove('hidden');
                } else {
                    item.remove();
                }
            });

        } else {
            // This handles both wrong code and no code scenarios
            const sectionsToShow = {
                portada: true,
                'no-code': true // Show our new section
            };

            document.querySelectorAll('[data-section]').forEach(item => {
                if (sectionsToShow[item.dataset.section]) {
                    item.classList.remove('hidden');
                } else {
                    item.remove();
                }
            });
        }

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('group-name').textContent = 'No se pudo cargar la invitación.';
        alert(error.message);
        document.querySelectorAll('.scroll-section[data-section]').forEach(item => item.remove());
    } finally {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
            spinner.style.opacity = '0';
            setTimeout(() => {
                spinner.style.display = 'none';
            }, 500); // Match the CSS transition duration
        }
        setupNavigation(); // Restore the call
    }
}

async function processEventDetails(eventKey, sectionsToShow, csvText) {
    try {
        if (!csvText) throw new Error('Event data is not available.');
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const headers = parseCsvRow(lines[0]);
        const dataRows = lines.slice(1).map(line => parseCsvRow(line));

        const colIndices = {
            evento: headers.indexOf('Evento'),
            lugar: headers.indexOf('Lugar'),
            fecha: headers.indexOf('Fecha'),
            direccion: headers.indexOf('Direccion'),
            mapa: headers.indexOf('Mapa')
        };

        for (const row of dataRows) {
            const encryptedEventName = row[colIndices.evento];
            if (!encryptedEventName) continue;

            const eventName = XXTEA.decryptFromBase64(encryptedEventName, eventKey);

            // Map new event names from the data source to the data-section names in the HTML
            let sectionName = eventName;
            if (eventName === 'recepcion') {
                sectionName = 'fiesta';
            } else if (eventName === 'video') {
                sectionName = 'zoom';
            }

            if (sectionName && sectionsToShow[sectionName]) {
                const decryptedFechaStr = XXTEA.decryptFromBase64(row[colIndices.fecha], eventKey) || '';
                const lugar = XXTEA.decryptFromBase64(row[colIndices.lugar], eventKey);
                const direccion = XXTEA.decryptFromBase64(row[colIndices.direccion], eventKey);
                const mapa = XXTEA.decryptFromBase64(row[colIndices.mapa], eventKey);

                let fecha = '';
                let hora = '';

                if (decryptedFechaStr) {
                    const dateObj = new Date(decryptedFechaStr);
                    if (!isNaN(dateObj)) {
                        // Format the date (e.g., Miércoles 19 de noviembre de 2025)
                        fecha = dateObj.toLocaleDateString('es-AR', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });

                        // Format the time (e.g., 10:00)
                        hora = dateObj.toLocaleTimeString('es-AR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        });
                    }
                }

                if (document.getElementById(`${sectionName}-fecha`)) {
                    document.getElementById(`${sectionName}-fecha`).textContent = fecha;
                }
                if (document.getElementById(`${sectionName}-hora`)) {
                    document.getElementById(`${sectionName}-hora`).textContent = hora;
                }
                if (document.getElementById(`${sectionName}-lugar`)) {
                    document.getElementById(`${sectionName}-lugar`).textContent = lugar;
                }
                if (document.getElementById(`${sectionName}-direccion`)) {
                    document.getElementById(`${sectionName}-direccion`).textContent = direccion;
                }
                const mapLink = document.getElementById(`${sectionName}-mapa`);
                if (mapLink && mapa) {
                    mapLink.href = mapa;
                    mapLink.classList.remove('hidden');
                }
            }
        }
    } catch (error) {
        console.error('Error fetching event details:', error);
        // Optionally, handle errors in fetching event details, e.g., show a message
    }
}

function setupSectionAnimations() {
    document.querySelectorAll('.scroll-section').forEach(section => {
        const video = section.querySelector('.transition-video');
        const canvas = section.querySelector('.transition-canvas');
        const watercolorImage = section.querySelector('.watercolor-image');
        if (!video || !canvas || !watercolorImage) return;

        video.playbackRate = 0.5;

        const ctx = canvas.getContext('2d');
        let animationFrameId = null;
        let isFullyVisible = false; // Flag for visibility

        function drawFrame() {
            if (video.paused || video.ended) {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
                return;
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL();
            watercolorImage.style.maskImage = `url(${dataURL})`;
            watercolorImage.style.webkitMaskImage = `url(${dataURL})`;
            animationFrameId = requestAnimationFrame(drawFrame);
        }

        function initializeFirstFrame() {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL();
            watercolorImage.style.maskImage = `url(${dataURL})`;
            watercolorImage.style.webkitMaskImage = `url(${dataURL})`;
            watercolorImage.style.visibility = 'visible';
        }

        function advanceAnimation() {
            if (!isFullyVisible || !video.paused || video.currentTime >= video.duration) {
                return;
            }

            video.play();
            
            if (!animationFrameId) {
                animationFrameId = requestAnimationFrame(drawFrame);
            }

            setTimeout(() => {
                video.pause();
            }, 150);
        }

        video.addEventListener('loadedmetadata', () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        });

        video.addEventListener('canplay', initializeFirstFrame, { once: true });

        section.addEventListener('click', advanceAnimation);
        section.addEventListener('mousemove', advanceAnimation);

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isFullyVisible = entry.isIntersecting;
            });
        }, { 
            root: document.querySelector('.scroll-container'),
            threshold: 1.0 
        });

        observer.observe(section);

        video.currentTime = 0;
    });
}