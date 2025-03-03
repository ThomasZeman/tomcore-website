import {css, setup} from 'goober';
import {h, render} from 'preact';
import {App} from './app.js';

setup(h);


const galleryContainer = css`
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 2px solid #ccc;
`;

const galleryTitle = css`
    font-size: 1.2rem;
    margin-bottom: 1rem;
`;

const Gallery = ({ images }: { images: string[] }) => {
    if (images.length === 0) return null;
    return (
        <div className={galleryContainer}>
            <div className={galleryTitle}>Full Resolution Images</div>
            <div>
                {images.map((uri, index) => (
                    <div key={index} className={css`
                        margin-bottom: 1rem;
                    `}>
                        <img src={uri} alt={`Full resolution ${index + 1}`} className={css`max-width: 100%;`} />
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- App Component ---


render(<App />, document.getElementById("app") as HTMLElement);
