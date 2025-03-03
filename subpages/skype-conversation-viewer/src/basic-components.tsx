import {css} from 'goober';
import {h, JSX} from 'preact';

export const Container = (props: { children: preact.ComponentChildren }) => (
    <div className={css`
        max-width: 800px;
        margin: 2rem auto;
        padding: 1rem;
        font-family: Arial, sans-serif;
    `}>
        {props.children}
    </div>
);

export const Title = (props: { children: preact.ComponentChildren }) => (
    <h1 className={css`
        text-align: center;
        color: #333;
    `}>
        {props.children}
    </h1>
);

export const FileInput = (props: { onChange: (e: JSX.TargetedEvent<HTMLInputElement>) => void }) => (
    <input
        className={css`
            display: block;
            margin: 1rem auto;
            font-size: 1rem;
        `}
        type="file"
        accept=".json"
        onChange={props.onChange}
    />
);
