document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    const googleSheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcjtPM-3LNZFamySSe9rbVOjTu1pRSQ0Te5ILx6MmF9ClbBJUZvnfPHYsIg4_CclD_7ba0lv1QMdiZ/pub?output=csv';

    if (code) {
        fetchGuestData(code, googleSheetUrl);
    } else {
        document.querySelectorAll('.scroll-section[data-section]').forEach(item => item.remove());
        const groupNameElement = document.getElementById('group-name');
        if(groupNameElement) groupNameElement.textContent = 'Bienvenido/a';
        setupNavigation(); // Restore the call
    }
    setupSectionAnimations();
});

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
        if(leftBtn) leftBtn.style.display = 'none';
        if(rightBtn) rightBtn.style.display = 'none';
        if(indicatorContainer) indicatorContainer.style.display = 'none';
        return;
    }

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

async function fetchGuestData(code, url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Could not fetch guest list.');
        
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const headers = parseCsvRow(lines[0]);
        const dataRows = lines.slice(1).map(line => parseCsvRow(line));

        const colIndices = {
            codigo: headers.indexOf('Codigo'),
            nombre: headers.indexOf('Nombre'),
            invitados: headers.indexOf('Invitados'),
            cantidad: headers.indexOf('Cantidad'),
            conferencia: headers.indexOf('Conferencia'),
            fiesta: headers.indexOf('Fiesta'),
            zoom: headers.indexOf('Zoom'),
            civil: headers.indexOf('Civil')
        };

        for (const key in colIndices) {
            if (colIndices[key] === -1) throw new Error(`Column "${key}" not found.`);
        }

        const guestRow = dataRows.find(row => row[colIndices.codigo] === code);

        if (guestRow) {
            document.getElementById('group-name').textContent = `¡Hola, ${guestRow[colIndices.nombre]}!`;
            document.getElementById('guest-names').textContent = `Invitación para: ${guestRow[colIndices.invitados]}`;
            const guestCount = guestRow[colIndices.cantidad];
            if (guestCount) {
                document.getElementById('guest-count').textContent = `(${guestCount} persona${guestCount > 1 ? 's' : ''})`;
            }

            const sectionsToShow = {
                portada: true,
                invitacion: true,
                civil: guestRow[colIndices.civil]?.toLowerCase() === 'si',
                discurso: guestRow[colIndices.conferencia]?.toLowerCase() === 'si',
                fiesta: guestRow[colIndices.fiesta]?.toLowerCase() === 'si',
                zoom: guestRow[colIndices.zoom]?.toLowerCase() === 'si',
                rsvp: guestRow[colIndices.fiesta]?.toLowerCase() === 'si',
                contratapa: true
            };

            document.querySelectorAll('[data-section]').forEach(item => {
                if (sectionsToShow[item.dataset.section]) {
                    item.classList.remove('hidden');
                } else {
                    item.remove();
                }
            });

        } else {
            document.getElementById('group-name').textContent = 'Invitación no encontrada';
            document.querySelectorAll('[data-section]').forEach(item => {
                const section = item.dataset.section;
                if (section !== 'portada' && section !== 'contratapa') {
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
        setupNavigation(); // Restore the call
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